package com.presence.session

import android.os.SystemClock
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.funkatronics.encoders.Base58
import com.presence.attest.AttestApi
import com.presence.attest.AttestException
import com.presence.attest.CheckpointBody
import com.presence.attest.MissionPolicy
import com.presence.evidence.CheckpointData
import com.presence.evidence.EphemeralKey
import com.presence.evidence.EvidenceChain
import com.presence.evidence.toHex
import com.presence.wallet.WalletRepository
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Drives one bounded mission: SIWS authorize -> timed checkpoints -> evidence root -> server verify.
 * The client only collects and signs evidence. Every PASS/FAIL shown comes from the ATTEST server.
 */
@HiltViewModel
class PresenceViewModel @Inject constructor(
    private val api: AttestApi,
    private val wallet: WalletRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(UiState(wallet = wallet.account))
    val state: StateFlow<UiState> = _state

    private var missionJob: Job? = null

    // Evidence window counters, reset at every checkpoint. Only counts are kept, never raw input.
    @Volatile private var windowTaps = 0
    @Volatile private var windowForeground = true
    @Volatile private var anyBackground = false

    init {
        refresh()
    }

    fun refresh() = viewModelScope.launch {
        try {
            val health = api.health()
            val mission = api.missions().firstOrNull()
            val profile = wallet.account?.let { api.profile(it.address) }
            _state.update { it.copy(health = health, mission = mission, profile = profile, backendError = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(backendError = reasonMessage((e as? AttestException)?.reason ?: "NETWORK_ERROR")) }
        }
    }

    fun connect(sender: ActivityResultSender) = viewModelScope.launch {
        guarded {
            val account = wallet.connect(sender)
            _state.update { it.copy(wallet = account) }
            refresh()
        }
    }

    fun disconnect() {
        wallet.disconnect()
        _state.update { it.copy(wallet = null, profile = null) }
    }

    fun openMission() = _state.update { it.copy(screen = Screen.Mission) }

    fun home() {
        missionJob?.cancel()
        _state.update { it.copy(screen = Screen.Home) }
        refresh()
    }

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun onPulse() {
        windowTaps++
        _state.update { s ->
            val a = s.screen as? Screen.Active ?: return@update s
            s.copy(screen = a.copy(confirmedThisWindow = true))
        }
    }

    fun onForeground(foreground: Boolean) {
        if (!foreground) {
            windowForeground = false
            anyBackground = true
        }
    }

    fun startMission(sender: ActivityResultSender) {
        val mission = _state.value.mission ?: return
        val account = wallet.account ?: run {
            _state.update { it.copy(message = reasonMessage("WALLET_NOT_CONNECTED")) }
            return
        }
        missionJob?.cancel()
        missionJob = viewModelScope.launch {
            val key = EphemeralKey.create()
            try {
                _state.update { it.copy(busy = true) }
                val session = api.createSession(account.address, mission.missionId, key.publicKeyB64)
                val signature = wallet.signMessage(sender, session.siwsMessage)
                val auth = api.authorize(session.sessionId, Base58.encodeToString(signature))
                log(session.sessionId, "authorized", auth.eligibility)
                _state.update { it.copy(busy = false) }

                val chain = EvidenceChain(session.sessionId, session.nonce)
                runProcess(session.sessionId, session.policy, chain, key)

                val checks = mutableListOf(
                    Check("Wallet signature", CheckStatus.PASSED),
                    Check("Seeker eligibility",
                        if (auth.eligibility == "SGT_VERIFIED") CheckStatus.PASSED else CheckStatus.DEV_BYPASS),
                    Check("Session nonce", CheckStatus.PASSED),
                    Check("Evidence continuity"),
                    Check("Mission policy"),
                    Check("Replay protection"),
                    Check("On-chain attestation"),
                )
                fun show() = _state.update { it.copy(screen = Screen.Verifying(checks.toList())) }
                show()

                val root = chain.root()
                api.submitEvidence(session.sessionId, root.toHex(), key.sign(root))
                checks[3] = checks[3].copy(status = CheckStatus.PASSED)
                show()

                val result = api.verify(session.sessionId)
                val receipt = result.receipt
                if (!result.verified || receipt == null) {
                    throw AttestException(result.reason ?: "POLICY_NOT_SATISFIED", result.detail ?: "")
                }
                checks[4] = checks[4].copy(status = CheckStatus.PASSED)
                checks[5] = checks[5].copy(status = CheckStatus.PASSED)
                checks[6] = checks[6].copy(status = when (receipt.settlement.status) {
                    "CONFIRMED" -> CheckStatus.PASSED
                    "NOT_CONFIGURED" -> CheckStatus.NOT_CONFIGURED
                    else -> CheckStatus.FAILED
                })
                show()
                delay(900) // let the final check land before the receipt
                _state.update { it.copy(screen = Screen.Result(receipt, chain.hashes.map { h -> h.toHex() })) }
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val err = e as? AttestException ?: AttestException("CLIENT_ERROR", e.javaClass.simpleName)
                log(null, "failed", err.reason)
                _state.update { it.copy(busy = false, screen = Screen.Failed(err.reason, err.detail)) }
            } finally {
                key.destroy()
            }
        }
    }

    private suspend fun runProcess(sessionId: String, policy: MissionPolicy, chain: EvidenceChain, key: EphemeralKey) {
        val start = SystemClock.elapsedRealtime()
        val intervalMs = policy.checkpointIntervalSeconds * 1000L
        val durationMs = policy.durationSeconds * 1000L
        windowTaps = 0
        windowForeground = true
        anyBackground = false
        var done = 0

        fun publish(confirmed: Boolean) = _state.update {
            it.copy(screen = Screen.Active(
                elapsedMs = SystemClock.elapsedRealtime() - start,
                checkpointsDone = done,
                checkpointsTotal = policy.requiredCheckpoints,
                durationMs = durationMs,
                confirmedThisWindow = confirmed,
                leftForeground = anyBackground,
            ))
        }
        publish(false)

        val ticker = viewModelScope.launch {
            while (isActive) {
                val a = _state.value.screen as? Screen.Active
                publish(a?.confirmedThisWindow ?: false)
                delay(250)
            }
        }
        try {
            for (i in 0 until policy.requiredCheckpoints) {
                val due = start + (i + 1) * intervalMs
                delay((due - SystemClock.elapsedRealtime()).coerceAtLeast(0))
                val cp = CheckpointData(
                    index = i,
                    timestampMs = System.currentTimeMillis(),
                    elapsedMs = SystemClock.elapsedRealtime() - start,
                    foreground = windowForeground,
                    interactions = windowTaps,
                )
                windowTaps = 0
                windowForeground = true
                val hash = chain.append(cp)
                api.checkpoint(sessionId, CheckpointBody(
                    cp.index, cp.timestampMs, cp.elapsedMs, cp.foreground, cp.interactions,
                    hash.toHex(), key.sign(hash)))
                done = i + 1
                publish(false)
            }
        } finally {
            ticker.cancel()
        }
    }

    private suspend fun guarded(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(busy = false, message = reasonMessage((e as? AttestException)?.reason ?: "CLIENT_ERROR")) }
        }
    }

    // Never logs keys, signatures, auth tokens or evidence contents.
    private fun log(sessionId: String?, stage: String, result: String) =
        Log.i("PRESENCE", "stage=$stage session=$sessionId result=$result")
}

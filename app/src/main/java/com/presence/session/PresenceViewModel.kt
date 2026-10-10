package com.presence.session

import android.os.SystemClock
import android.util.Base64
import com.presence.ui.screens.formatToken
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
    @Volatile private var windowResponseMs = -1L
    // Set while a session runs, so onPulse can time the answer against the window's prompt.
    @Volatile private var sessionStart = 0L
    @Volatile private var intervalMsRunning = 10_000L
    @Volatile private var promptAtRunning: List<Long> = emptyList()
    @Volatile private var windowForeground = true
    @Volatile private var anyBackground = false

    init {
        refresh()
    }

    fun refresh() = viewModelScope.launch {
        try {
            val health = api.health()
            val missions = api.missions()
            val profile = wallet.account?.let { api.profile(it.address) }
            val pools = runCatching { api.pools().missions }.getOrDefault(emptyMap())
            _state.update { s ->
                val selected = missions.firstOrNull { m -> m.missionId == s.mission?.missionId } ?: missions.firstOrNull()
                s.copy(health = health, missions = missions, mission = selected, profile = profile, pools = pools,
                    backendError = null)
            }
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
            // Off mainnet, give a fresh test wallet fee SOL and test tokens so it can stake (server-side guarded).
            ensureTestFunds(account.address)
            refresh()
        }
    }

    /** Off mainnet only: one faucet grant (fee SOL + test tokens) per wallet; the server enforces both. */
    private suspend fun ensureTestFunds(address: String) {
        if (_state.value.health?.network == "mainnet") return
        try {
            api.faucet(address)
        } catch (e: AttestException) {
            log(null, "faucet", e.reason)
        }
    }

    fun disconnect() {
        wallet.disconnect()
        _state.update { it.copy(wallet = null, profile = null) }
    }

    fun openMission() = _state.update { it.copy(screen = Screen.Mission) }

    fun openMission(m: MissionPolicy) = _state.update { it.copy(mission = m, screen = Screen.Mission) }

    fun home() {
        missionJob?.cancel()
        _state.update { it.copy(screen = Screen.Home) }
        refresh()
    }

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun onPulse() {
        windowTaps++
        if (windowResponseMs < 0 && promptAtRunning.isNotEmpty()) {
            val elapsed = SystemClock.elapsedRealtime() - sessionStart
            val window = (elapsed / intervalMsRunning).toInt().coerceAtMost(promptAtRunning.size - 1)
            windowResponseMs = (elapsed - window * intervalMsRunning - promptAtRunning[window]).coerceAtLeast(0)
        }
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
            var staked: String? = null
            try {
                _state.update { it.copy(busy = true) }
                if (mission.stake.token > 0) ensureTestFunds(account.address)
                val session = api.createSession(account.address, mission.missionId, key.publicKeyB64)
                val stakeTx = session.stake?.let { Base64.decode(it.transaction, Base64.NO_WRAP) }
                val (signature, stakeSigned) = wallet.signSession(sender, session.siwsMessage, stakeTx)
                val auth = api.authorize(session.sessionId, Base58.encodeToString(signature),
                    stakeSigned?.let { Base64.encodeToString(it, Base64.NO_WRAP) })
                staked = session.stake?.let { "${formatToken(it.amount)} ${it.symbol}" }
                log(session.sessionId, "authorized", auth.eligibility)
                _state.update { it.copy(busy = false) }

                // Short countdown after returning from the wallet so the first window isn't missed.
                // Server timing starts at authorize; this only makes the first window longer, never shorter.
                for (n in 3 downTo 1) {
                    _state.update { it.copy(screen = Screen.Countdown(n)) }
                    delay(1000)
                }
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
                // A stake is only lost if the session got past authorize (the server forfeits it).
                val lost = staked.takeIf { err.reason !in setOf("STAKE_REQUIRED", "STAKE_FAILED", "NETWORK_ERROR", "WALLET_REJECTED") }
                _state.update { it.copy(busy = false, screen = Screen.Failed(err.reason, err.detail, lost)) }
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
        // Each window's presence check appears at an unpredictable moment, 15-60% into the window.
        val promptAt = List(policy.requiredCheckpoints) { (intervalMs * (0.15 + Math.random() * 0.45)).toLong() }
        sessionStart = start
        intervalMsRunning = intervalMs
        promptAtRunning = promptAt
        windowResponseMs = -1

        fun publish(confirmed: Boolean) = _state.update {
            val elapsed = SystemClock.elapsedRealtime() - start
            val window = (elapsed / intervalMs).toInt().coerceAtMost(policy.requiredCheckpoints - 1)
            it.copy(screen = Screen.Active(
                elapsedMs = elapsed,
                checkpointsDone = done,
                checkpointsTotal = policy.requiredCheckpoints,
                durationMs = durationMs,
                confirmedThisWindow = confirmed,
                leftForeground = anyBackground,
                sealed = chain.hashes.take(done).map { h -> h.toHex() },
                promptVisible = !confirmed && elapsed % intervalMs >= promptAt[window],
            ))
        }
        publish(false)

        val ticker = viewModelScope.launch {
            while (isActive) {
                val a = _state.value.screen as? Screen.Active
                publish(a?.confirmedThisWindow ?: false)
                delay(200)
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
                    responseMs = windowResponseMs,
                )
                windowTaps = 0
                windowResponseMs = -1
                windowForeground = true
                val hash = chain.append(cp)
                api.checkpoint(sessionId, CheckpointBody(
                    cp.index, cp.timestampMs, cp.elapsedMs, cp.foreground, cp.interactions, cp.responseMs,
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

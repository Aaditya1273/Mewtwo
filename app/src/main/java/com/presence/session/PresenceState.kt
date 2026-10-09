package com.presence.session

import com.presence.attest.Health
import com.presence.attest.MissionPolicy
import com.presence.attest.Profile
import com.presence.attest.Receipt
import com.presence.wallet.WalletAccount

enum class CheckStatus { PENDING, PASSED, DEV_BYPASS, NOT_CONFIGURED, FAILED }

/** One verification step shown to the user. Only marked PASSED after the server confirmed it. */
data class Check(val label: String, val status: CheckStatus = CheckStatus.PENDING)

sealed interface Screen {
    data object Home : Screen
    data object Mission : Screen
    data class Countdown(val seconds: Int) : Screen
    data class Active(
        val elapsedMs: Long,
        val checkpointsDone: Int,
        val checkpointsTotal: Int,
        val durationMs: Long,
        val confirmedThisWindow: Boolean,
        val leftForeground: Boolean,
        /** Hex hashes of checkpoints the server has accepted, in order. */
        val sealed: List<String> = emptyList(),
        /** The presence check for the current window is showing. */
        val promptVisible: Boolean = false,
    ) : Screen
    data class Verifying(val checks: List<Check>) : Screen
    data class Result(val receipt: Receipt, val checkpointHashes: List<String>) : Screen
    data class Failed(val reason: String, val detail: String) : Screen
}

data class UiState(
    val screen: Screen = Screen.Home,
    val wallet: WalletAccount? = null,
    val health: Health? = null,
    val backendError: String? = null,
    val missions: List<MissionPolicy> = emptyList(),
    /** The mission the user picked; defaults to the first one. */
    val mission: MissionPolicy? = null,
    val profile: Profile? = null,
    val busy: Boolean = false,
    val message: String? = null,
)

/** User-facing copy per failure reason; technical detail stays in logs / the evidence view. */
fun reasonMessage(reason: String): String = when (reason) {
    "SESSION_EXPIRED" -> "The session expired. Start a new mission."
    "INVALID_NONCE", "NONCE_REPLAY" -> "This session was already used. Start a new mission."
    "INVALID_SIGNATURE" -> "The wallet signature could not be verified."
    "INVALID_IDENTITY" -> "The wallet or session key is not valid."
    "SGT_NOT_ELIGIBLE" -> "No Seeker Genesis Token found in this wallet."
    "EVIDENCE_CHAIN_INVALID" -> "Session evidence was inconsistent and was rejected."
    "POLICY_NOT_SATISFIED" -> "The mission requirements were not met."
    "AUTOMATION_DETECTED" -> "The presence checks were answered like a script, not a person."
    "ALREADY_CLAIMED" -> "This device already completed today's proof."
    "ATTESTATION_FAILED" -> "Verification succeeded but the on-chain attestation failed."
    "NETWORK_ERROR" -> "Can't reach the ATTEST server."
    "WALLET_NOT_CONNECTED" -> "Connect your wallet first."
    "WALLET_NOT_FOUND" -> "No Mobile Wallet Adapter wallet is installed."
    "WALLET_REJECTED" -> "The wallet request was declined."
    "CLIENT_ERROR" -> "Something went wrong on this device."
    else -> "Something went wrong ($reason)."
}

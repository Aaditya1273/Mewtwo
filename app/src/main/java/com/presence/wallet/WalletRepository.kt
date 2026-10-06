package com.presence.wallet

import android.content.SharedPreferences
import com.funkatronics.encoders.Base58
import com.presence.attest.AttestException
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import com.solana.mobilewalletadapter.clientlib.successPayload
import javax.inject.Inject
import javax.inject.Singleton

data class WalletAccount(val address: String, val label: String)

/**
 * Mobile Wallet Adapter (Seed Vault on Seeker). Persists only the public address, label and the
 * MWA auth token (app-private prefs; backups are disabled in the manifest).
 */
@Singleton
class WalletRepository @Inject constructor(
    private val adapter: MobileWalletAdapter,
    private val prefs: SharedPreferences,
) {
    var account: WalletAccount? = load()
        private set

    private fun load(): WalletAccount? {
        val address = prefs.getString(KEY_ADDRESS, null) ?: return null
        prefs.getString(KEY_TOKEN, null)?.let { adapter.authToken = it } ?: return null
        return WalletAccount(address, prefs.getString(KEY_LABEL, "") ?: "")
    }

    suspend fun connect(sender: ActivityResultSender): WalletAccount =
        when (val result = adapter.connect(sender)) {
            is TransactionResult.Success -> {
                val auth = result.authResult
                WalletAccount(Base58.encodeToString(auth.publicKey), auth.accountLabel ?: "Wallet").also {
                    prefs.edit()
                        .putString(KEY_ADDRESS, it.address)
                        .putString(KEY_LABEL, it.label)
                        .putString(KEY_TOKEN, auth.authToken)
                        .apply()
                    account = it
                }
            }
            is TransactionResult.NoWalletFound -> throw AttestException("WALLET_NOT_FOUND")
            is TransactionResult.Failure -> throw AttestException("WALLET_REJECTED", result.e.message ?: "")
        }

    /** Detached ed25519 signature of [message] by the connected account (SIWS-format text). */
    suspend fun signMessage(sender: ActivityResultSender, message: String): ByteArray {
        val current = account ?: throw AttestException("WALLET_NOT_CONNECTED")
        val address = Base58.decode(current.address)
        val result = adapter.transact(sender) {
            signMessagesDetached(arrayOf(message.toByteArray()), arrayOf(address))
        }
        return when (result) {
            is TransactionResult.Success ->
                result.successPayload?.messages?.firstOrNull()?.signatures?.firstOrNull()
                    ?: throw AttestException("INVALID_SIGNATURE", "wallet returned no signature")
            is TransactionResult.NoWalletFound -> throw AttestException("WALLET_NOT_FOUND")
            is TransactionResult.Failure -> throw AttestException("WALLET_REJECTED", result.e.message ?: "")
        }
    }

    fun disconnect() {
        prefs.edit().remove(KEY_ADDRESS).remove(KEY_LABEL).remove(KEY_TOKEN).apply()
        adapter.authToken = null
        account = null
    }

    private companion object {
        const val KEY_ADDRESS = "wallet_address"
        const val KEY_LABEL = "wallet_label"
        const val KEY_TOKEN = "wallet_auth_token"
    }
}

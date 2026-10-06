package com.presence.evidence

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Per-session EC P-256 key held in Android Keystore (hardware-backed where the device supports it).
 * The wallet's SIWS signature binds its fingerprint to the session, so a stolen session id + nonce
 * is useless without this device-held key. This is NOT hardware attestation of the device.
 */
class EphemeralKey private constructor(private val alias: String) {
    private val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    val publicKeyB64: String
        get() = Base64.encodeToString(keyStore.getCertificate(alias).publicKey.encoded, Base64.NO_WRAP)

    /** DER-encoded ECDSA(SHA-256) signature, base64. */
    fun sign(data: ByteArray): String {
        val key = keyStore.getKey(alias, null) as PrivateKey
        val sig = Signature.getInstance("SHA256withECDSA").apply { initSign(key); update(data) }.sign()
        return Base64.encodeToString(sig, Base64.NO_WRAP)
    }

    fun destroy() = keyStore.deleteEntry(alias)

    companion object {
        private const val PROVIDER = "AndroidKeyStore"

        fun create(alias: String = "presence-session"): EphemeralKey {
            KeyStore.getInstance(PROVIDER).apply { load(null) }.deleteEntry(alias)
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).apply {
                initialize(
                    KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                        .setDigests(KeyProperties.DIGEST_SHA256)
                        .build()
                )
            }.generateKeyPair()
            return EphemeralKey(alias)
        }
    }
}

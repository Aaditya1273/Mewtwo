package com.presence.evidence

import java.security.MessageDigest

/**
 * Evidence hash chain. Must stay byte-for-byte identical to backend/attest/evidence.py
 * (golden vectors in EvidenceChainTest and backend/tests/test_attest.py).
 *
 * genesis      = SHA256("PRESENCE/genesis/v1" | session_id | nonce)
 * checkpoint_i = SHA256("PRESENCE/cp/v2" | prev_hash | payload_i | nonce)
 * payload_i    = "{index}|{timestamp_ms}|{elapsed_ms}|{foreground 0/1}|{interactions}|{response_ms}"
 * root         = SHA256("PRESENCE/root/v1" | last_checkpoint_hash | witness_root)
 */
data class CheckpointData(
    val index: Int,
    val timestampMs: Long,
    val elapsedMs: Long,
    val foreground: Boolean,
    val interactions: Int,
    /** ms the presence check was on screen before it was answered; -1 = not answered. */
    val responseMs: Long = -1,
) {
    fun payload(): ByteArray =
        "$index|$timestampMs|$elapsedMs|${if (foreground) 1 else 0}|$interactions|$responseMs".toByteArray()
}

class EvidenceChain(sessionId: String, private val nonce: String) {
    var head: ByteArray = hash("PRESENCE/genesis/v1".toByteArray(), sessionId.toByteArray(), nonce.toByteArray())
        private set
    val hashes = mutableListOf<ByteArray>()

    fun append(cp: CheckpointData): ByteArray {
        head = hash("PRESENCE/cp/v2".toByteArray(), head, cp.payload(), nonce.toByteArray())
        hashes += head
        return head
    }

    /** No witnesses participate in P2 sessions, so the witness root is 32 zero bytes. */
    fun root(witnessRoot: ByteArray = ByteArray(32)): ByteArray =
        hash("PRESENCE/root/v1".toByteArray(), head, witnessRoot)

    companion object {
        private fun hash(vararg parts: ByteArray): ByteArray {
            val md = MessageDigest.getInstance("SHA-256")
            parts.forEachIndexed { i, p ->
                if (i > 0) md.update('|'.code.toByte())
                md.update(p)
            }
            return md.digest()
        }
    }
}

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

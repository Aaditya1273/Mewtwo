package com.presence

import com.presence.evidence.CheckpointData
import com.presence.evidence.EvidenceChain
import com.presence.evidence.toHex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** Golden vectors shared with backend/tests/test_attest.py::test_evidence_chain_golden_vector. */
class EvidenceChainTest {
    private fun cps() = (0 until 6).map { i ->
        CheckpointData(i, 1_700_000_000_000 + i * 10_000L, (i + 1) * 10_000L, true, 2, 700L + i * 100)
    }

    @Test
    fun matchesServerImplementation() {
        val chain = EvidenceChain("session-1", "nonce-1")
        assertEquals("c52244702ffcfcac1b4198db2c0c1f086640a36441c9bd265217dec3fae9a5ef", chain.head.toHex())
        cps().forEach { chain.append(it) }
        assertEquals("296120d3f97cbd8a1a082fc4990f18dcb1e8068d36fdea928169286c527ee07e", chain.hashes[0].toHex())
        assertEquals("4cf4a2f0811cc0fcad119242576453a92ae0572475e2e5573741be4f1b1ef1bc", chain.root().toHex())
    }

    @Test
    fun anyChangedCheckpointChangesTheRoot() {
        val honest = EvidenceChain("session-1", "nonce-1").apply { cps().forEach { append(it) } }
        val tampered = EvidenceChain("session-1", "nonce-1").apply {
            cps().forEachIndexed { i, cp -> append(if (i == 2) cp.copy(interactions = 9) else cp) }
        }
        assertNotEquals(honest.root().toHex(), tampered.root().toHex())
    }
}

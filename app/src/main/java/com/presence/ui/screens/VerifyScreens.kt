package com.presence.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import com.presence.attest.Receipt
import com.presence.session.CheckStatus
import com.presence.session.Screen
import com.presence.session.reasonMessage
import com.presence.ui.theme.Ink

@Composable
fun VerifyingScreen(v: Screen.Verifying) = Page {
    Header(null)
    Gap(40)
    Eyebrow("ATTEST engine")
    Gap(8)
    Text("VERIFYING", style = MaterialTheme.typography.displayMedium, color = Ink.Text)
    Gap(32)
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        v.checks.forEach { c ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.width(28.dp)) { StatusMark(c.status) }
                Text(c.label, style = MaterialTheme.typography.bodyLarge,
                    color = if (c.status == CheckStatus.PENDING) Ink.Muted else Ink.Text)
                Spacer(Modifier.weight(1f))
                statusNote(c.status)?.let { (text, color) -> Eyebrow(text, color) }
            }
        }
    }
}

@Composable
private fun StatusMark(status: CheckStatus) = when (status) {
    CheckStatus.PENDING -> CircularProgressIndicator(Modifier.size(14.dp), color = Ink.Muted, strokeWidth = 1.5.dp)
    CheckStatus.PASSED -> Text("✓", color = Ink.Verified)
    CheckStatus.DEV_BYPASS -> Text("!", color = Ink.Dev)
    CheckStatus.NOT_CONFIGURED -> Text("–", color = Ink.Muted)
    CheckStatus.FAILED -> Text("✕", color = Ink.Fail)
}

private fun statusNote(status: CheckStatus): Pair<String, Color>? = when (status) {
    CheckStatus.DEV_BYPASS -> "dev bypass" to Ink.Dev
    CheckStatus.NOT_CONFIGURED -> "not configured" to Ink.Muted
    CheckStatus.FAILED -> "failed" to Ink.Fail
    else -> null
}

@Composable
fun ReceiptScreen(r: Screen.Result, onDone: () -> Unit) = Page {
    val rc: Receipt = r.receipt
    var showEvidence by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
        Header(rc.mode)
        Gap(36)
        Eyebrow("Trust receipt")
        Gap(8)
        Text("VERIFIED ✓", style = MaterialTheme.typography.displayMedium, color = Ink.Verified)
        Gap(6)
        Text("${assuranceLabel(rc.assurance)} ATTESTED", style = MaterialTheme.typography.labelLarge, color = Ink.Text)
        Text(rc.missionName, style = MaterialTheme.typography.bodyMedium, color = Ink.Muted)
        Gap(28)
        Divider()
        Gap(18)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Stat("Duration", "${rc.durationSeconds.toInt()} seconds")
            Stat("Evidence", "${rc.checkpointCount} checkpoints")
            Stat("Streak", if (rc.streak == 1) "1 day" else "${rc.streak} days")
        }
        Gap(24)
        Text("+${rc.reward.xp} XP", style = MaterialTheme.typography.displayMedium, color = Ink.Text)
        Gap(4)
        Text("${rc.leagueBefore} #${rc.rankBefore}  →  ${rc.leagueAfter} #${rc.rankAfter}",
            style = MaterialTheme.typography.titleMedium, color = Ink.Text)
        Gap(24)
        Divider()
        Gap(16)
        val s = rc.settlement
        val (settleText, settleColor) = when (s.status) {
            "CONFIRMED" -> "Anchored on ${s.network}" to Ink.Verified
            "NOT_CONFIGURED" -> "On-chain anchoring not configured" to Ink.Muted
            else -> "On-chain anchoring failed" to Ink.Fail
        }
        Eyebrow("DailyAttestation")
        Gap(6)
        Text(settleText, style = MaterialTheme.typography.bodyLarge, color = settleColor)
        if (rc.mode == "development") {
            Gap(6)
            Text("Development mode: Seeker eligibility was bypassed. This receipt is not production verification.",
                style = MaterialTheme.typography.bodyMedium, color = Ink.Dev)
        }

        TextButton(onClick = { showEvidence = !showEvidence }) {
            Text(if (showEvidence) "HIDE EVIDENCE" else "VIEW EVIDENCE",
                style = MaterialTheme.typography.labelLarge, color = Ink.Text)
        }
        if (showEvidence) Evidence(r)
    }
    Gap(12)
    PrimaryButton("Done", onClick = onDone)
}

@Composable
private fun Evidence(r: Screen.Result) {
    val rc = r.receipt
    val uri = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Mono("evidence_root", rc.evidenceRoot)
        Mono("session", rc.sessionId)
        rc.checks.forEach { (k, v) -> Mono(k, v) }
        r.checkpointHashes.forEachIndexed { i, h -> Mono("checkpoint_$i", h) }
        rc.settlement.signature?.let { Mono("tx", it) }
        rc.settlement.detail?.let { Mono("settlement", it) }
        rc.settlement.explorerUrl?.let { url ->
            TextButton(onClick = { uri.openUri(url) }) {
                Text("OPEN IN EXPLORER ↗", style = MaterialTheme.typography.labelMedium, color = Ink.Text)
            }
        }
    }
}

@Composable
private fun Mono(label: String, value: String) = Column {
    Eyebrow(label)
    Text(value, style = MaterialTheme.typography.labelSmall, color = Ink.Text)
}

@Composable
fun FailedScreen(f: Screen.Failed, onRetry: () -> Unit, onHome: () -> Unit) = Page {
    Header(null)
    Gap(40)
    Eyebrow("ATTEST engine")
    Gap(8)
    Text("NOT VERIFIED", style = MaterialTheme.typography.displayMedium, color = Ink.Fail)
    Gap(16)
    Text(reasonMessage(f.reason), style = MaterialTheme.typography.bodyLarge, color = Ink.Text)
    Gap(10)
    Text(f.reason, style = MaterialTheme.typography.labelSmall, color = Ink.Muted)
    if (f.detail.isNotBlank()) Text(f.detail, style = MaterialTheme.typography.labelSmall, color = Ink.Muted)
    Spacer(Modifier.weight(1f))
    PrimaryButton("Try again", onClick = onRetry)
    Gap(10)
    SecondaryButton("Home", onClick = onHome)
}

package com.presence.ui.screens

import android.content.Context
import android.content.Intent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
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
    val ctx = LocalContext.current
    val haptics = LocalHapticFeedback.current
    var showEvidence by rememberSaveable { mutableStateOf(false) }
    val seal = remember { Animatable(0.6f) }
    LaunchedEffect(Unit) {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        seal.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = 300f))
    }
    val s = rc.settlement
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
        Header(rc.mode)
        Gap(20)
        // The certificate
        Column(
            Modifier.fillMaxWidth()
                .border(1.dp, Ink.Verified.copy(alpha = 0.5f), RoundedCornerShape(20.dp))
                .background(Ink.Surface, RoundedCornerShape(20.dp))
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow("Trust receipt")
                Spacer(Modifier.weight(1f))
                Eyebrow(rc.sessionId.take(8), color = Ink.Muted)
            }
            Gap(14)
            Text("VERIFIED ✓", style = MaterialTheme.typography.displayMedium, color = Ink.Verified,
                modifier = Modifier.scale(seal.value))
            Text("${assuranceLabel(rc.assurance)} ATTESTED", style = MaterialTheme.typography.labelLarge, color = Ink.Text)
            Text(rc.missionName, style = MaterialTheme.typography.bodyMedium, color = Ink.Muted)
            Gap(18)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Stat("Duration", "${rc.durationSeconds.toInt()}s")
                Stat("Evidence", "${rc.checkpointCount} sealed")
                Stat("Streak", if (rc.streak == 1) "1 day" else "${rc.streak} days")
            }
            Gap(18)
            Perforation()
            Gap(18)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("+${rc.reward.xp} XP", style = MaterialTheme.typography.headlineMedium, color = Ink.Text)
                    when {
                        rc.reward.stake > 0 && s.rewardToken > 0 -> Text(
                            "${formatToken(rc.reward.stake)} ${s.rewardSymbol} stake back" +
                                if (rc.reward.bonus > 0) " + ${formatToken(rc.reward.bonus)} bonus from the pool" else "",
                            style = MaterialTheme.typography.bodyMedium, color = Ink.Verified)
                        s.rewardToken > 0 -> Text("+${formatToken(s.rewardToken)} ${s.rewardSymbol} paid from sponsor pool",
                            style = MaterialTheme.typography.bodyMedium, color = Ink.Verified)
                        rc.reward.funding == "UNFUNDED" -> Text("Sponsor pool empty: no ${rc.reward.symbol} paid",
                            style = MaterialTheme.typography.bodyMedium, color = Ink.Muted)
                    }
                    Gap(6)
                    Text("${rc.leagueBefore} #${rc.rankBefore} → ${rc.leagueAfter} #${rc.rankAfter}",
                        style = MaterialTheme.typography.titleMedium, color = Ink.Text)
                    Gap(10)
                    val (settleText, settleColor) = when (s.status) {
                        "CONFIRMED" -> "Anchored on ${s.network}" to Ink.Verified
                        "NOT_CONFIGURED" -> "Not anchored (not configured)" to Ink.Muted
                        else -> "Anchoring failed" to Ink.Fail
                    }
                    Text(settleText, style = MaterialTheme.typography.bodyMedium, color = settleColor)
                }
                s.explorerUrl?.let { Qr(it, 104) }
            }
        }
        if (rc.mode == "development") {
            Gap(10)
            Text("Development mode: Seeker eligibility was bypassed. Not production verification.",
                style = MaterialTheme.typography.bodyMedium, color = Ink.Dev)
        }
        Row {
            TextButton(onClick = { showEvidence = !showEvidence }) {
                Text(if (showEvidence) "HIDE EVIDENCE" else "VIEW EVIDENCE",
                    style = MaterialTheme.typography.labelLarge, color = Ink.Text)
            }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { shareReceipt(ctx, rc) }) {
                Text("SHARE", style = MaterialTheme.typography.labelLarge, color = Ink.Text)
            }
        }
        if (showEvidence) Evidence(r)
    }
    Gap(12)
    PrimaryButton("Done", onClick = onDone)
}

@Composable
private fun Perforation() = Canvas(Modifier.fillMaxWidth().height(1.dp)) {
    drawLine(Ink.Line, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 2f,
        pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 10f)))
}

/** QR code of the on-chain proof link. */
@Composable
private fun Qr(text: String, sizeDp: Int) {
    val bits = remember(text) { QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0) }
    Canvas(Modifier.size(sizeDp.dp).background(Ink.Text, RoundedCornerShape(8.dp)).padding(6.dp)) {
        val cell = size.width / bits.width
        for (y in 0 until bits.height) for (x in 0 until bits.width) if (bits[x, y])
            drawRect(Ink.Bg, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
    }
}

private fun shareReceipt(ctx: Context, rc: Receipt) {
    val text = buildString {
        append("VERIFIED ✓ ${assuranceLabel(rc.assurance)} attested by PRESENCE\n")
        append("${rc.missionName}: ${rc.durationSeconds.toInt()}s, ${rc.checkpointCount} sealed checkpoints\n")
        rc.settlement.explorerUrl?.let { append("On-chain proof: $it\n") }
        if (rc.mode == "development") append("(development mode)\n")
    }
    ctx.startActivity(Intent.createChooser(
        Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share proof"))
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
        rc.settlement.rewardMint?.let { Mono("reward_mint", it) }
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
    f.stakeLost?.let {
        Gap(10)
        Text("Your $it stake went to the pool. It pays the bonus of everyone who finished.",
            style = MaterialTheme.typography.bodyMedium, color = Ink.Fail)
    }
    Gap(10)
    Text(f.reason, style = MaterialTheme.typography.labelSmall, color = Ink.Muted)
    if (f.detail.isNotBlank()) Text(f.detail, style = MaterialTheme.typography.labelSmall, color = Ink.Muted)
    Spacer(Modifier.weight(1f))
    PrimaryButton("Try again", onClick = onRetry)
    Gap(10)
    SecondaryButton("Home", onClick = onHome)
}

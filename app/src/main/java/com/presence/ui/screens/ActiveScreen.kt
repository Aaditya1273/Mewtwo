package com.presence.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.presence.session.Screen
import com.presence.ui.theme.Ink

@Composable
fun ActiveScreen(a: Screen.Active, onPulse: () -> Unit) = Page {
    val haptics = LocalHapticFeedback.current
    val view = LocalView.current
    val context = LocalContext.current
    // The phone sits face-up on the desk: keep the screen (and so the session) alive.
    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
    LaunchedEffect(a.checkpointsDone) {
        if (a.checkpointsDone > 0) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
    }
    LaunchedEffect(a.promptVisible) {
        if (a.promptVisible) context.getSystemService(Vibrator::class.java)?.vibrate(
            VibrationEffect.createWaveform(longArrayOf(0, 180, 120, 180), -1))
    }
    val breathe = rememberInfiniteTransition(label = "breathe")
    val glow by breathe.animateFloat(0.3f, 1f, infiniteRepeatable(tween(1100), RepeatMode.Reverse), label = "glow")

    Header(null)
    Gap(20)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.alpha(glow)) { Dot(if (a.leftForeground) Ink.Fail else Ink.Verified) }
        HGap(10)
        Eyebrow(if (a.leftForeground) "Session interrupted" else "Session live · recording evidence",
            color = if (a.leftForeground) Ink.Fail else Ink.Text)
    }
    Gap(24)
    TimerRing(a)
    Gap(28)
    Eyebrow("Evidence chain")
    Gap(12)
    EvidenceChainView(a, glow)
    Spacer(Modifier.weight(1f))
    PresenceCheck(a) {
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        onPulse()
    }
}

@Composable
private fun TimerRing(a: Screen.Active) {
    val progress by animateFloatAsState((a.elapsedMs.toFloat() / a.durationMs).coerceIn(0f, 1f), tween(200), label = "p")
    val remaining = ((a.durationMs - a.elapsedMs).coerceAtLeast(0) + 999) / 1000
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(196.dp)) {
            val stroke = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round)
            drawArc(Ink.Line, 0f, 360f, false, style = stroke)
            drawArc(Ink.Text, -90f, 360f * progress, false, style = stroke)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("%02d:%02d".format(remaining / 60, remaining % 60),
                style = MaterialTheme.typography.displayMedium, color = Ink.Text)
            Eyebrow("${a.checkpointsDone} of ${a.checkpointsTotal} sealed")
        }
    }
}

/** One block per checkpoint: sealed (server accepted, shows its fingerprint), sealing, or pending. */
@Composable
private fun EvidenceChainView(a: Screen.Active, glow: Float) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        (0 until a.checkpointsTotal).chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                row.forEachIndexed { j, i ->
                    if (j > 0) Box(Modifier.width(6.dp).height(1.dp).background(
                        if (i <= a.sealed.size) Ink.Verified.copy(alpha = 0.6f) else Ink.Line))
                    Block(i, a.sealed.getOrNull(i), sealing = i == a.sealed.size, glow, Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun Block(index: Int, hash: String?, sealing: Boolean, glow: Float, modifier: Modifier) {
    val border by animateColorAsState(
        when {
            hash != null -> Ink.Verified
            sealing -> Ink.Text.copy(alpha = glow)
            else -> Ink.Line
        }, tween(400), label = "b")
    Column(
        modifier
            .border(1.dp, border, RoundedCornerShape(10.dp))
            .background(if (hash != null) Ink.Verified.copy(alpha = 0.06f) else Ink.Surface, RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 10.dp),
    ) {
        Text("#${index + 1}", style = MaterialTheme.typography.labelMedium,
            color = if (hash != null) Ink.Verified else Ink.Muted)
        Gap(4)
        Text(
            when {
                hash != null -> "${hash.take(4)}…${hash.takeLast(4)}"
                sealing -> "sealing…"
                else -> "pending"
            },
            style = MaterialTheme.typography.labelSmall,
            color = if (hash != null) Ink.Text else Ink.Muted,
        )
    }
}

@Composable
private fun PresenceCheck(a: Screen.Active, onConfirm: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(132.dp)) {
        AnimatedVisibility(a.promptVisible, enter = fadeIn() + slideInVertically { it / 3 },
            exit = fadeOut() + slideOutVertically { it / 3 }) {
            Column(
                Modifier.fillMaxSize()
                    .border(1.dp, Ink.Text.copy(alpha = 0.4f), RoundedCornerShape(16.dp))
                    .background(Ink.Surface, RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Still here?", style = MaterialTheme.typography.titleMedium, color = Ink.Text)
                PrimaryButton("I'm here", onClick = onConfirm)
            }
        }
        if (!a.promptVisible) {
            Text(
                when {
                    a.leftForeground -> "You left the session. That window will not satisfy the mission policy."
                    a.confirmedThisWindow -> "✓ Presence confirmed for this window"
                    else -> "Phone down, focus on. It buzzes once per window; tap \"I'm here\" when it does."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = when {
                    a.leftForeground -> Ink.Fail
                    a.confirmedThisWindow -> Ink.Verified
                    else -> Ink.Muted
                },
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().align(Alignment.Center),
            )
        }
    }
}

@Composable
fun CountdownScreen(seconds: Int) = Page {
    Header(null)
    Spacer(Modifier.weight(1f))
    Eyebrow("Get ready", modifier = Modifier.fillMaxWidth())
    Gap(8)
    Text("$seconds", style = MaterialTheme.typography.displayLarge, color = Ink.Text)
    Gap(8)
    Text("Phone down, screen on. Each buzz is a presence check: tap \"I'm here\". Leave the app and the stake goes to the pool.",
        style = MaterialTheme.typography.bodyLarge, color = Ink.Muted)
    Spacer(Modifier.weight(1f))
}

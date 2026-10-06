package com.presence.ui.screens

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.presence.session.Screen
import com.presence.ui.theme.Ink

@Composable
fun ActiveScreen(a: Screen.Active, onPulse: () -> Unit) = Page {
    val pulse = rememberInfiniteTransition(label = "pulse")
    val glow by pulse.animateFloat(0.35f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "glow")

    Header(null)
    Gap(40)
    Eyebrow("Mission active")
    Gap(8)
    val remaining = ((a.durationMs - a.elapsedMs).coerceAtLeast(0) + 999) / 1000
    Text("%02d:%02d".format(remaining / 60, remaining % 60), style = MaterialTheme.typography.displayLarge, color = Ink.Text)
    Gap(20)

    Eyebrow("Checkpoints")
    Gap(10)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(a.checkpointsTotal) { i ->
            Box(Modifier.weight(1f).height(6.dp).background(
                if (i < a.checkpointsDone) Ink.Text else Ink.Line, RoundedCornerShape(3.dp)))
        }
    }
    Gap(18)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.alpha(glow)) { Dot(if (a.leftForeground) Ink.Fail else Ink.Verified) }
        HGap(10)
        Eyebrow(if (a.leftForeground) "Process evidence · interrupted" else "Process evidence · active",
            color = if (a.leftForeground) Ink.Fail else Ink.Text)
    }

    Spacer(Modifier.weight(1f))

    val confirmed = a.confirmedThisWindow
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(176.dp)
                .scale(if (confirmed) 1f else 0.94f + 0.06f * glow)
                .border(1.dp, if (confirmed) Ink.Verified else Ink.Text.copy(alpha = glow), CircleShape)
                .clickable(onClick = onPulse),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (confirmed) "✓\nCONFIRMED" else "TAP TO\nCONFIRM",
                style = MaterialTheme.typography.labelLarge,
                color = if (confirmed) Ink.Verified else Ink.Text,
                textAlign = TextAlign.Center,
            )
        }
    }

    Spacer(Modifier.weight(1f))
    Text(
        if (a.leftForeground) "You left the session. That checkpoint will not satisfy the mission policy."
        else "Confirm once per checkpoint. Do not leave the session.",
        style = MaterialTheme.typography.bodyMedium,
        color = if (a.leftForeground) Ink.Fail else Ink.Muted,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

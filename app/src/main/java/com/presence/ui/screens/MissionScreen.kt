package com.presence.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
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
import androidx.compose.ui.unit.dp
import com.presence.session.UiState
import com.presence.ui.theme.Ink

@Composable
private fun Guarantee(title: String, body: String) = Row {
    Text("◆", style = MaterialTheme.typography.labelMedium, color = Ink.Verified, modifier = Modifier.padding(top = 3.dp))
    HGap(12)
    Column {
        Text(title, style = MaterialTheme.typography.titleMedium, color = Ink.Text)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = Ink.Muted)
    }
}

@Composable
fun MissionScreen(s: UiState, onBack: () -> Unit, onStart: () -> Unit) = Page {
    val m = s.mission ?: return@Page
    var consent by rememberSaveable { mutableStateOf(false) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("← BACK", style = MaterialTheme.typography.labelMedium, color = Ink.Muted) }
        Spacer(Modifier.weight(1f))
        if (s.health?.mode == "development") Chip("Development mode", Ink.Dev)
    }
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
    Gap(20)
    Eyebrow("Mission")
    Gap(10)
    Text(m.name.uppercase(), style = MaterialTheme.typography.headlineMedium, color = Ink.Text)
    if (m.description.isNotBlank()) {
        Gap(8)
        Text(m.description, style = MaterialTheme.typography.bodyMedium, color = Ink.Muted)
    }
    if (m.sponsor.isNotBlank()) {
        Gap(6)
        Text(m.sponsor, style = MaterialTheme.typography.labelSmall, color = Ink.Dev)
    }
    Gap(20)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        m.steps.forEachIndexed { i, step ->
            Row {
                Text("0${i + 1}", style = MaterialTheme.typography.labelSmall, color = Ink.Muted)
                HGap(14)
                Text(step, style = MaterialTheme.typography.bodyLarge, color = Ink.Text)
            }
        }
    }
    Gap(28)
    Divider()
    Gap(18)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Stat("Assurance", assuranceLabel(m.requiredAssurance))
        Stat("Duration", "${m.durationSeconds} seconds")
        if (m.stake.token > 0) Stat("Stake", "${formatToken(m.stake.token)} ${m.reward.symbol}")
        else Stat("Reward", "+${m.reward.xp} XP")
    }
    Gap(22)
    Eyebrow("What PRESENCE verifies")
    Gap(10)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (m.stake.token > 0) Guarantee("Skin in the game",
            "Finish: your ${formatToken(m.stake.token)} ${m.reward.symbol} back + ${(m.stake.bonusRate * 100).toInt()}% from the pool. " +
                "Quit: it feeds the pool for everyone who finished.")
        Guarantee("Cheat-proof timer", "The server times the session and checks for a human at random moments. No local timer to fake.")
        Guarantee("One Seeker, one clock-in", "Your wallet signs a one-time server code; on Seeker, one device = one claim.")
        Guarantee("On-chain", "Every finished session is a permanent attestation on Solana, paid in the same transaction.")
    }

    Gap(8)
    }
    Gap(12)
    Row(Modifier.fillMaxWidth().clickable { consent = !consent }, verticalAlignment = Alignment.Top) {
        Checkbox(checked = consent, onCheckedChange = { consent = it },
            colors = CheckboxDefaults.colors(checkedColor = Ink.Text, checkmarkColor = Ink.Bg, uncheckedColor = Ink.Muted))
        Text(
            (if (m.stake.token > 0) "I stake ${formatToken(m.stake.token)} ${m.reward.symbol}, which I lose if I leave or miss a check. " else "") +
                "During the session PRESENCE records only whether it stays on screen and when I answer. " +
                "No location, no sensors, no background tracking; only a hash goes on-chain.",
            style = MaterialTheme.typography.bodyMedium, color = Ink.Muted,
        )
    }
    Gap(16)
    PrimaryButton(
        when {
            s.busy -> "Waiting for wallet…"
            m.stake.token > 0 -> "Stake ${formatToken(m.stake.token)} & clock in"
            else -> "Clock in"
        },
        enabled = consent && !s.busy, onClick = onStart)
}

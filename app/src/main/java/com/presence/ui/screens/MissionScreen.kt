package com.presence.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
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
fun MissionScreen(s: UiState, onBack: () -> Unit, onStart: () -> Unit) = Page {
    val m = s.mission ?: return@Page
    var consent by rememberSaveable { mutableStateOf(false) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("← BACK", style = MaterialTheme.typography.labelMedium, color = Ink.Muted) }
        Spacer(Modifier.weight(1f))
        if (s.health?.mode == "development") Chip("Development mode", Ink.Dev)
    }
    Gap(28)
    Eyebrow("Mission")
    Gap(10)
    Text(m.name.uppercase(), style = MaterialTheme.typography.headlineMedium, color = Ink.Text)
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
        Stat("Checkpoints", "${m.requiredCheckpoints}")
    }

    Spacer(Modifier.weight(1f))

    Row(Modifier.fillMaxWidth().clickable { consent = !consent }, verticalAlignment = Alignment.Top) {
        Checkbox(checked = consent, onCheckedChange = { consent = it },
            colors = CheckboxDefaults.colors(checkedColor = Ink.Text, checkmarkColor = Ink.Bg, uncheckedColor = Ink.Muted))
        Text(
            "For ${m.durationSeconds} seconds only, PRESENCE records whether this screen stays in the foreground " +
                "and how many times you confirm. No location, no sensor streams, no background tracking. " +
                "Only a hash of this evidence is anchored on-chain.",
            style = MaterialTheme.typography.bodyMedium, color = Ink.Muted,
        )
    }
    Gap(16)
    PrimaryButton(if (s.busy) "Waiting for wallet…" else "Start mission", enabled = consent && !s.busy, onClick = onStart)
}

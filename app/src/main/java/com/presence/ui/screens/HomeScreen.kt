package com.presence.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.presence.session.UiState
import com.presence.ui.theme.Ink

@Composable
fun HomeScreen(s: UiState, onConnect: () -> Unit, onAttest: () -> Unit, onDisconnect: () -> Unit, onRetry: () -> Unit) =
    Page {
        Header(s.health?.mode)
        Gap(48)
        Eyebrow("Today's proof")
        Gap(12)

        val profile = s.profile
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${profile?.streak ?: 0}", style = MaterialTheme.typography.displayLarge, color = Ink.Text)
            HGap(12)
            Text("DAY\nSTREAK", style = MaterialTheme.typography.labelLarge, color = Ink.Muted,
                modifier = Modifier.padding(bottom = 18.dp))
        }
        Gap(8)
        val standing = when {
            profile == null -> "NOT YET RANKED"
            profile.rank == null -> "${profile.league} · UNRANKED"
            else -> "${profile.league} #${profile.rank}"
        }
        Text(standing, style = MaterialTheme.typography.headlineMedium, color = Ink.Text)
        if (profile != null) {
            Gap(6)
            Text("${profile.xp} XP · ${profile.verifiedCount} verified action${if (profile.verifiedCount == 1) "" else "s"} · reputation ${profile.reputation}",
                style = MaterialTheme.typography.bodyMedium, color = Ink.Muted)
        }

        Spacer(Modifier.weight(1f))

        s.backendError?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = Ink.Fail)
            TextButton(onClick = onRetry) { Text("RETRY", style = MaterialTheme.typography.labelLarge, color = Ink.Text) }
            Gap(12)
        }

        s.mission?.let { m ->
            Divider()
            Gap(16)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Stat("Assurance", assuranceLabel(m.requiredAssurance))
                Stat("Reward", "+${m.reward.xp} XP")
                Stat("Duration", "${m.durationSeconds}s")
            }
            Gap(24)
        }

        when {
            s.wallet == null -> PrimaryButton("Connect wallet", enabled = !s.busy, onClick = onConnect)
            profile?.provedToday == true -> PrimaryButton("Proved today ✓", enabled = false) {}
            else -> PrimaryButton("Attest now", enabled = s.mission != null && !s.busy, onClick = onAttest)
        }
        s.wallet?.let { w ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("${w.label} · ${shortAddress(w.address)}", style = MaterialTheme.typography.labelSmall, color = Ink.Muted)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDisconnect) {
                    Text("DISCONNECT", style = MaterialTheme.typography.labelMedium, color = Ink.Muted)
                }
            }
        }
    }

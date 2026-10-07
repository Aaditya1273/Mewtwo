package com.presence.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.presence.attest.Profile
import com.presence.session.UiState
import com.presence.ui.theme.Ink

private fun leagueColor(league: String?) = when (league) {
    "ELITE" -> Color(0xFFB9A7FF)
    "GOLD" -> Color(0xFFE9C46A)
    "SILVER" -> Color(0xFFC9CED6)
    else -> Color(0xFFD08C60) // BRONZE
}

@Composable
fun HomeScreen(s: UiState, onConnect: () -> Unit, onAttest: () -> Unit, onDisconnect: () -> Unit, onRetry: () -> Unit) =
    Page {
        Header(s.health?.mode)
        Gap(28)
        IdentityCard(s)
        Gap(22)
        Eyebrow("Last 7 days")
        Gap(10)
        WeekRow(s.profile)

        Spacer(Modifier.weight(1f))

        s.backendError?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = Ink.Fail)
            TextButton(onClick = onRetry) { Text("RETRY", style = MaterialTheme.typography.labelLarge, color = Ink.Text) }
            Gap(12)
        }

        s.mission?.let { m ->
            Eyebrow("Today's proof")
            Gap(6)
            Text(m.name, style = MaterialTheme.typography.headlineMedium, color = Ink.Text)
            Gap(14)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Stat("Assurance", assuranceLabel(m.requiredAssurance))
                Stat("Reward", "+${m.reward.xp} XP")
                Stat("Duration", "${m.durationSeconds}s")
            }
            Gap(20)
        }

        when {
            s.wallet == null -> PrimaryButton("Connect wallet", enabled = !s.busy, onClick = onConnect)
            s.profile?.provedToday == true -> PrimaryButton("Proved today ✓", enabled = false) {}
            else -> PrimaryButton("Attest now", enabled = s.mission != null && !s.busy, onClick = onAttest)
        }
        s.wallet?.let {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDisconnect) {
                    Text("DISCONNECT", style = MaterialTheme.typography.labelMedium, color = Ink.Muted)
                }
            }
        }
    }

/** Passport-style card: who you are in PRESENCE, from server state only. */
@Composable
private fun IdentityCard(s: UiState) {
    val p = s.profile
    val accent = leagueColor(p?.league)
    Column(
        Modifier.fillMaxWidth()
            .border(1.dp, accent.copy(alpha = 0.45f), RoundedCornerShape(20.dp))
            .background(Ink.Surface, RoundedCornerShape(20.dp))
            .padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("Presence passport")
            Spacer(Modifier.weight(1f))
            Box(Modifier.border(1.dp, accent, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp)) {
                Text(p?.league ?: "UNRANKED", style = MaterialTheme.typography.labelMedium, color = accent)
            }
        }
        Gap(14)
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${p?.streak ?: 0}", style = MaterialTheme.typography.displayLarge, color = Ink.Text)
            HGap(12)
            Text("DAY\nSTREAK", style = MaterialTheme.typography.labelLarge, color = Ink.Muted,
                modifier = Modifier.padding(bottom = 18.dp))
            Spacer(Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(bottom = 14.dp)) {
                Text(p?.rank?.let { "#$it" } ?: "—", style = MaterialTheme.typography.headlineMedium, color = Ink.Text)
                Eyebrow("Rank")
            }
        }
        Gap(10)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Stat("XP", "${p?.xp ?: 0}")
            Stat("Verified", "${p?.verifiedCount ?: 0}")
            Stat("Reputation", "${p?.reputation ?: 0}")
        }
        Gap(14)
        Text(s.wallet?.let { "${it.label} · ${shortAddress(it.address)}" } ?: "No wallet connected",
            style = MaterialTheme.typography.labelSmall, color = Ink.Muted)
    }
}

/**
 * Proved days, derived from the server's streak: a streak is by definition consecutive days
 * ending today (if proved today) or yesterday.
 */
@Composable
private fun WeekRow(p: Profile?) {
    val streak = p?.streak ?: 0
    val endsToday = p?.provedToday == true
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        for (daysAgo in 6 downTo 0) {
            val offset = if (endsToday) daysAgo else daysAgo - 1
            val proved = offset in 0 until streak
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier.size(30.dp)
                        .border(1.dp, if (proved) Ink.Verified else Ink.Line, CircleShape)
                        .background(if (proved) Ink.Verified.copy(alpha = 0.15f) else Color.Transparent, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { if (proved) Text("✓", color = Ink.Verified, style = MaterialTheme.typography.labelMedium) }
                Gap(4)
                Text(if (daysAgo == 0) "today" else "-$daysAgo", style = MaterialTheme.typography.labelSmall, color = Ink.Muted)
            }
        }
    }
}

package com.presence.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.presence.ui.theme.Ink

@Composable
fun Page(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Ink.Bg)
            .safeDrawingPadding()
            .padding(horizontal = 24.dp, vertical = 20.dp),
        content = content,
    )
}

@Composable
fun Eyebrow(text: String, color: Color = Ink.Muted, modifier: Modifier = Modifier) =
    Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, color = color, modifier = modifier)

@Composable
fun Chip(text: String, color: Color) {
    Box(
        Modifier
            .border(1.dp, color.copy(alpha = 0.5f), RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) { Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, color = color) }
}

@Composable
fun Header(mode: String?) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("PRESENCE", style = MaterialTheme.typography.labelLarge, color = Ink.Text)
        Spacer(Modifier.weight(1f))
        if (mode == "development") Chip("Development mode", Ink.Dev)
    }
}

@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) = Button(
    onClick = onClick,
    enabled = enabled,
    modifier = Modifier.fillMaxWidth().height(58.dp),
    shape = RoundedCornerShape(14.dp),
    colors = ButtonDefaults.buttonColors(
        containerColor = Ink.Text, contentColor = Ink.Bg,
        disabledContainerColor = Ink.Surface, disabledContentColor = Ink.Muted),
    contentPadding = PaddingValues(0.dp),
) { Text(text.uppercase(), style = MaterialTheme.typography.labelLarge) }

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit) = OutlinedButton(
    onClick = onClick,
    modifier = Modifier.fillMaxWidth().height(52.dp),
    shape = RoundedCornerShape(14.dp),
    border = BorderStroke(1.dp, Ink.Line),
) { Text(text.uppercase(), style = MaterialTheme.typography.labelLarge, color = Ink.Text) }

@Composable
fun Stat(label: String, value: String, modifier: Modifier = Modifier, valueColor: Color = Ink.Text) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Eyebrow(label)
        Text(value, style = MaterialTheme.typography.titleMedium, color = valueColor)
    }
}

@Composable
fun Divider() = Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.Line))

@Composable
fun Dot(color: Color) = Box(Modifier.size(8.dp).background(color, CircleShape))

@Composable
fun Gap(h: Int) = Spacer(Modifier.height(h.dp))

@Composable
fun HGap(w: Int) = Spacer(Modifier.width(w.dp))

fun shortAddress(a: String) = if (a.length > 10) "${a.take(4)}…${a.takeLast(4)}" else a

fun assuranceLabel(level: String) = when (level) {
    "P1" -> "P1 VERIFIED"
    "P2" -> "P2 PROCESS"
    "P3" -> "P3 WITNESSED"
    "P4" -> "P4 HIGH ASSURANCE"
    else -> level
}

fun formatToken(v: Double): String = if (v % 1.0 == 0.0) v.toLong().toString() else "%.2f".format(v).trimEnd('0').trimEnd('.')

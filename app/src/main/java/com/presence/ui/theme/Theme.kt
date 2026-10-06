package com.presence.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object Ink {
    val Bg = Color(0xFF0A0A0B)
    val Surface = Color(0xFF131315)
    val Line = Color(0xFF26262B)
    val Text = Color(0xFFF2F1EE)
    val Muted = Color(0xFF8B8B91)
    val Verified = Color(0xFF7FE3B8)
    val Dev = Color(0xFFF2B84B)
    val Fail = Color(0xFFF07A7A)
}

private val Sans = FontFamily.SansSerif

val PresenceType = Typography(
    displayLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Light, fontSize = 88.sp, letterSpacing = (-3).sp),
    displayMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Light, fontSize = 56.sp, letterSpacing = (-1.5).sp),
    headlineMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 26.sp, letterSpacing = (-0.3).sp),
    titleMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, letterSpacing = 0.2.sp),
    bodyLarge = TextStyle(fontFamily = Sans, fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, letterSpacing = 2.sp),
    labelMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 2.2.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp, letterSpacing = 0.sp),
)

@Composable
fun PresenceTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            background = Ink.Bg, surface = Ink.Surface, onBackground = Ink.Text, onSurface = Ink.Text,
            primary = Ink.Text, onPrimary = Ink.Bg, outline = Ink.Line, error = Ink.Fail,
        ),
        typography = PresenceType,
        content = content,
    )
}

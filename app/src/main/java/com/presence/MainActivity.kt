package com.presence

import android.graphics.Color
import android.os.Bundle
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.activity.SystemBarStyle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.presence.session.PresenceViewModel
import com.presence.session.Screen
import com.presence.ui.screens.ActiveScreen
import com.presence.ui.screens.CountdownScreen
import com.presence.ui.screens.FailedScreen
import com.presence.ui.screens.HomeScreen
import com.presence.ui.screens.MissionScreen
import com.presence.ui.screens.ReceiptScreen
import com.presence.ui.screens.VerifyingScreen
import com.presence.ui.theme.PresenceTheme
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Dark UI: force light status/nav bar icons regardless of system theme.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        val sender = ActivityResultSender(this)
        setContent { PresenceTheme { PresenceRoot(sender) } }
    }
}

@Composable
fun PresenceRoot(sender: ActivityResultSender, vm: PresenceViewModel = hiltViewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    // Foreground continuity is evidence: report when the session screen leaves the foreground.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_STOP) vm.onForeground(false)
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(s.message) {
        s.message?.let { snackbar.showSnackbar(it); vm.clearMessage() }
    }
    BackHandler(enabled = s.screen != Screen.Home) { vm.home() }

    Box(Modifier.fillMaxSize()) {
        // Crossfade between screens; Active/Countdown updates keep the same key so they don't re-animate.
        AnimatedContent(s.screen, contentKey = { it::class }, transitionSpec = { fadeIn(tween(280)) togetherWith fadeOut(tween(180)) },
            label = "screen") { screen ->
        when (screen) {
            Screen.Home -> HomeScreen(s, onConnect = { vm.connect(sender) }, onAttest = vm::openMission,
                onDisconnect = vm::disconnect, onRetry = { vm.refresh() })
            Screen.Mission -> MissionScreen(s, onBack = vm::home, onStart = { vm.startMission(sender) })
            is Screen.Countdown -> CountdownScreen(screen.seconds)
            is Screen.Active -> ActiveScreen(screen, onPulse = vm::onPulse)
            is Screen.Verifying -> VerifyingScreen(screen)
            is Screen.Result -> ReceiptScreen(screen, onDone = vm::home)
            is Screen.Failed -> FailedScreen(screen, onRetry = vm::openMission, onHome = vm::home)
        }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

package com.presence.di

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import com.presence.BuildConfig
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import javax.inject.Singleton

@InstallIn(SingletonComponent::class)
@Module
object AppModule {

    @Provides
    @Singleton
    fun sharedPrefs(@ApplicationContext ctx: Context): SharedPreferences =
        ctx.getSharedPreferences("presence", Context.MODE_PRIVATE)

    @Provides
    @Singleton
    fun walletAdapter(): MobileWalletAdapter =
        MobileWalletAdapter(
            connectionIdentity = ConnectionIdentity(
                identityUri = Uri.parse("https://presence.local"),
                iconUri = Uri.parse("favicon.ico"),
                identityName = "PRESENCE",
            )
        ).apply {
            blockchain = when (BuildConfig.NETWORK) {
                "mainnet" -> Solana.Mainnet
                else -> Solana.Devnet
            }
        }

    @Provides
    @Singleton
    fun httpClient(): HttpClient = HttpClient(Android) {
        engine {
            connectTimeout = 10_000
            socketTimeout = 45_000 // /verify waits for on-chain confirmation
        }
    }
}

package com.presence.attest

import com.presence.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Server-side failure reasons (backend/attest/errors.py) plus client-only ones. */
class AttestException(val reason: String, val detail: String = "") : Exception("$reason $detail")

@Serializable data class Health(val mode: String, val network: String, val settlement: String)

@Serializable data class Reward(val xp: Int)

@Serializable
data class MissionPolicy(
    @SerialName("mission_id") val missionId: String,
    val name: String,
    val steps: List<String>,
    @SerialName("required_assurance") val requiredAssurance: String,
    @SerialName("duration_seconds") val durationSeconds: Int,
    @SerialName("required_checkpoints") val requiredCheckpoints: Int,
    @SerialName("checkpoint_interval_seconds") val checkpointIntervalSeconds: Int,
    @SerialName("min_interactions_per_checkpoint") val minInteractionsPerCheckpoint: Int,
    val reward: Reward,
)

@Serializable
data class SessionCreated(
    @SerialName("session_id") val sessionId: String,
    val nonce: String,
    @SerialName("siws_message") val siwsMessage: String,
    val policy: MissionPolicy,
    val mode: String,
)

@Serializable data class Authorized(val eligibility: String, @SerialName("sgt_mint") val sgtMint: String? = null)

@Serializable
data class Profile(
    val xp: Int,
    val league: String,
    val rank: Int? = null,
    val streak: Int,
    @SerialName("best_streak") val bestStreak: Int,
    @SerialName("verified_count") val verifiedCount: Int,
    val reputation: Int,
    @SerialName("proved_today") val provedToday: Boolean,
)

@Serializable
data class Settlement(
    val status: String,
    val signature: String? = null,
    val network: String? = null,
    val detail: String? = null,
    @SerialName("explorer_url") val explorerUrl: String? = null,
)

@Serializable
data class Receipt(
    val status: String,
    val mode: String,
    @SerialName("session_id") val sessionId: String,
    @SerialName("mission_name") val missionName: String,
    val assurance: String,
    @SerialName("duration_seconds") val durationSeconds: Double,
    @SerialName("checkpoint_count") val checkpointCount: Int,
    @SerialName("evidence_root") val evidenceRoot: String,
    val checks: Map<String, String>,
    val reward: Reward,
    @SerialName("league_before") val leagueBefore: String,
    @SerialName("rank_before") val rankBefore: Int,
    @SerialName("league_after") val leagueAfter: String,
    @SerialName("rank_after") val rankAfter: Int,
    val streak: Int,
    val settlement: Settlement,
)

@Serializable
data class VerifyResult(
    val verified: Boolean,
    val reason: String? = null,
    val detail: String? = null,
    val receipt: Receipt? = null,
)

@Serializable @PublishedApi internal data class ErrorBody(val error: String, val detail: String = "")

@Singleton
class AttestApi @Inject constructor(@PublishedApi internal val http: HttpClient) {
    @PublishedApi internal val json = Json { ignoreUnknownKeys = true }
    @PublishedApi internal val base = BuildConfig.BACKEND_URL.trimEnd('/')

    suspend fun health(): Health = get("/health")
    suspend fun missions(): List<MissionPolicy> = get("/missions")
    suspend fun profile(wallet: String): Profile = get("/profile/$wallet")

    suspend fun createSession(wallet: String, missionId: String, ephemeralPubkey: String): SessionCreated =
        post("/session", mapOf("wallet" to wallet, "mission_id" to missionId, "ephemeral_pubkey" to ephemeralPubkey))

    suspend fun authorize(sessionId: String, signatureB58: String): Authorized =
        post("/session/$sessionId/authorize", mapOf("signature" to signatureB58))

    suspend fun checkpoint(sessionId: String, body: CheckpointBody) {
        call { http.post("$base/session/$sessionId/checkpoint") { jsonBody(json.encodeToString(body)) } }
    }

    suspend fun submitEvidence(sessionId: String, rootHex: String, signature: String) {
        call { http.post("$base/session/$sessionId/evidence") {
            jsonBody(json.encodeToString(mapOf("evidence_root" to rootHex, "signature" to signature)))
        } }
    }

    suspend fun verify(sessionId: String): VerifyResult = post("/verify", mapOf("session_id" to sessionId))

    private suspend inline fun <reified T> get(path: String): T =
        json.decodeFromString(call { http.get("$base$path") })

    private suspend inline fun <reified T> post(path: String, body: Map<String, String>): T =
        json.decodeFromString(call { http.post("$base$path") { jsonBody(json.encodeToString(body)) } })

    @PublishedApi
    internal fun HttpRequestBuilder.jsonBody(text: String) {
        contentType(ContentType.Application.Json)
        setBody(text)
    }

    /** Returns the response body, or throws AttestException with the server's failure reason. */
    @PublishedApi
    internal suspend fun call(request: suspend () -> HttpResponse): String {
        val response = try {
            request()
        } catch (e: IOException) {
            throw AttestException("NETWORK_ERROR", e.message ?: "")
        }
        val text = response.bodyAsText()
        if (!response.status.isSuccess()) {
            val err = runCatching { json.decodeFromString<ErrorBody>(text) }.getOrNull()
            throw AttestException(err?.error ?: "HTTP_${response.status.value}", err?.detail ?: "")
        }
        return text
    }
}

@Serializable
data class CheckpointBody(
    val index: Int,
    @SerialName("timestamp_ms") val timestampMs: Long,
    @SerialName("elapsed_ms") val elapsedMs: Long,
    val foreground: Boolean,
    val interactions: Int,
    val hash: String,
    val signature: String,
)

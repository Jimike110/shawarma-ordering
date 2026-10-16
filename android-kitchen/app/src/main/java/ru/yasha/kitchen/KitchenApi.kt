package ru.yasha.kitchen

import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

class ApiFailure(val status: Int) : Exception("Kitchen API status $status")

object KitchenApi {
    // Fixed paths and fixed HTTPS origin: never accept a URL from JavaScript or redirects.
    fun call(path: String, token: String? = null, body: JSONObject? = null, cookie: String? = null): JSONObject {
        require(path in setOf("/api/kitchen-device/native-token", "/api/kitchen-device/alerts", "/api/kitchen-device/heartbeat"))
        val connection = URL(BuildConfig.KITCHEN_ORIGIN + path).openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            cookie?.let {
                connection.setRequestProperty("Cookie", it)
                connection.setRequestProperty("Origin", BuildConfig.KITCHEN_ORIGIN)
            }
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status !in 200..299) throw ApiFailure(status)
            // Feed is metadata only; bound the response even if the endpoint is misconfigured.
            val text = connection.inputStream.bufferedReader().use { reader ->
                val out = StringBuilder()
                val chunk = CharArray(8192)
                while (true) {
                    val size = reader.read(chunk)
                    if (size < 0) break
                    require(out.length + size <= 1_000_000)
                    out.append(chunk, 0, size)
                }
                out.toString()
            }
            return JSONObject(text)
        } finally { connection.disconnect() }
    }
}

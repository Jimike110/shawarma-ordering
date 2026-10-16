package ru.yasha.kitchen

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class Credential(val token: String, val store: Long, val until: Long)

/** Only the restricted monitoring credential is persisted here. Never bridge it to JS. */
class KitchenVault(context: Context) {
    private val prefs = context.getSharedPreferences("kitchen-vault", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("kitchen-alert", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("kitchen-alert", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(c: Credential) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val bytes = JSONObject().put("token", c.token).put("store", c.store).put("until", c.until).toString().toByteArray()
        prefs.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("credential", Base64.encodeToString(cipher.doFinal(bytes), Base64.NO_WRAP)).commit()
    }
    fun read(): Credential? = try {
        val value = prefs.getString("credential", null)
        if (value == null) null else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)))
            }
            val obj = JSONObject(String(cipher.doFinal(Base64.decode(value, Base64.NO_WRAP))))
            Credential(obj.getString("token"), obj.getLong("store"), obj.getLong("until"))
        }
    } catch (_: Exception) { clear(); null }
    fun clear() { prefs.edit().remove("credential").remove("iv").commit() }
    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(value) { prefs.edit().putBoolean("enabled", value).commit() }
    var tested: Boolean
        get() = prefs.getBoolean("tested", false)
        set(value) { prefs.edit().putBoolean("tested", value).commit() }
}

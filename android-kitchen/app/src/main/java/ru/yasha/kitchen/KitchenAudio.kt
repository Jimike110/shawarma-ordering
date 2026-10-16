package ru.yasha.kitchen

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer

class KitchenAudio(private val context: Context) {
    private var player: MediaPlayer? = null
    private var focus: AudioFocusRequest? = null
    @Volatile var failed = false
        private set
    val volume: Int get() {
        val audio = context.getSystemService(AudioManager::class.java)
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM).coerceAtLeast(1)
        return audio.getStreamVolume(AudioManager.STREAM_ALARM) * 100 / max
    }
    val playing: Boolean get() = synchronized(this) { player?.isPlaying == true }
    @Synchronized fun play() {
        if (playing) return
        stop()
        try {
            val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes).setOnAudioFocusChangeListener { change ->
                    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) { failed = true; stop() }
                }.build()
            focus = request
            if (context.getSystemService(AudioManager::class.java).requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                failed = true; stop(); return
            }
            val sound = MediaPlayer()
            player = sound
            sound.setAudioAttributes(attributes)
            context.resources.openRawResourceFd(R.raw.new_order).use { sound.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            sound.setOnCompletionListener { stop() }
            sound.setOnErrorListener { _, _, _ -> failed = true; stop(); true }
            sound.prepare()
            sound.start()
            failed = false
        } catch (_: Exception) { failed = true; stop() }
    }
    @Synchronized fun stop() {
        player?.release(); player = null
        focus?.let { context.getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) }
        focus = null
    }
}

package ru.yasha.kitchen

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import android.net.ConnectivityManager
import android.net.Network
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object MonitorHealth {
    @Volatile var running = false
    @Volatile var lastSuccess = 0L
    @Volatile var error = ""
    @Volatile var revoked = false
    @Volatile var audioReady = false
}

class KitchenMonitorService : Service() {
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private lateinit var vault: KitchenVault
    private lateinit var audio: KitchenAudio
    private var wakeLock: PowerManager.WakeLock? = null
    private var task: java.util.concurrent.ScheduledFuture<*>? = null
    private val schedule = AlertSchedule()
    private var credential: Credential? = null
    private var heartbeatAt = 0L
    private var count = 0
    private var wakeRenewedAt = 0L
    @Volatile private var destroyed = false
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (destroyed || !MonitorHealth.running || executor.isShutdown) return
            try { executor.execute { tickSafely() } } catch (_: java.util.concurrent.RejectedExecutionException) { /* Service stopped while the callback was queued. */ }
        }
    }
    private val timer = Handler(Looper.getMainLooper())
    private val repeat = object : Runnable {
        override fun run() {
            if (!MonitorHealth.running) return
            val now = SystemClock.elapsedRealtime()
            synchronized(schedule) {
                if (schedule.due(now, audio.playing)) { audio.play(); if (!audio.failed) schedule.played(now) }
            }
            timer.postDelayed(this, 1000)
        }
    }
    override fun onBind(intent: Intent?) = null
    override fun onCreate() {
        super.onCreate()
        vault = KitchenVault(this)
        audio = KitchenAudio(this)
        channel(this)
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") {
            vault.enabled = false
            executor.execute { sendStoppedHeartbeat(); stopSelf() }
            return START_NOT_STICKY
        }
        val c = vault.read()
        if (!vault.enabled || c == null || c.until <= System.currentTimeMillis()) {
            stopSelf(); return START_NOT_STICKY
        }
        if (Build.VERSION.SDK_INT >= 34) startForeground(7, notification("Подключение к кухне…"), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(7, notification("Подключение к кухне…"))
        if (task == null) {
            credential = c
            MonitorHealth.running = true
            timer.post(repeat)
            MonitorHealth.error = ""
            wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "yasha:kitchen-monitor").apply {
                setReferenceCounted(false); acquire(10 * 60 * 1000L)
            }
            wakeRenewedAt = SystemClock.elapsedRealtime()
            task = executor.scheduleWithFixedDelay({ tickSafely() }, 0, 5, TimeUnit.SECONDS)
        }
        return START_STICKY
    }
    private fun tickSafely() {
        try { tick() } catch (_: Exception) { if (!destroyed) MonitorHealth.error = "Ошибка мониторинга. Откройте кухню и проверьте звук." }
    }
    private fun tick() {
        if (destroyed) return
        val c = credential ?: return
        if (c.until <= System.currentTimeMillis()) { revoke(); return }
        if (wakeLock?.isHeld != true || SystemClock.elapsedRealtime() - wakeRenewedAt >= 9 * 60 * 1000L) {
            wakeLock?.acquire(10 * 60 * 1000L)
            wakeRenewedAt = SystemClock.elapsedRealtime()
        }
        val start = SystemClock.elapsedRealtime()
        try {
            val result = KitchenApi.call("/api/kitchen-device/alerts", c.token)
            if (destroyed) return
            require(result.getLong("store_id") == c.store)
            count = result.getJSONArray("orders").length()
            synchronized(schedule) { schedule.reconcile(count > 0); if (!schedule.pending) audio.stop() }
            MonitorHealth.lastSuccess = SystemClock.elapsedRealtime()
            MonitorHealth.error = ""
        } catch (e: ApiFailure) {
            if (destroyed) return
            if (e.status == 401 || e.status == 403) { revoke(); return }
            MonitorHealth.error = "Нет подтверждения очереди. Приём заказов продолжается."
        } catch (_: Exception) {
            if (destroyed) return
            MonitorHealth.error = "Нет связи. Проверьте интернет; приём заказов продолжается."
        }
        val now = SystemClock.elapsedRealtime()
        timer.post { timer.removeCallbacks(repeat); repeat.run() }
        if (audio.volume == 0 || audio.failed) MonitorHealth.error = "Звук недоступен. Проверьте громкость будильника и динамик."
        if (!getSystemService(NotificationManager::class.java).areNotificationsEnabled()) MonitorHealth.error = "Разрешите уведомления Android и проверьте мониторинг."
        if (!getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)) MonitorHealth.error = "Отключите оптимизацию батареи для кухни и повторите проверку."
        MonitorHealth.audioReady = vault.tested && !audio.failed && audio.volume > 0 &&
            getSystemService(NotificationManager::class.java).areNotificationsEnabled() &&
            getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        if (now - heartbeatAt >= 15_000) {
            try { heartbeat(c, true); heartbeatAt = now } catch (e: ApiFailure) {
                if (e.status == 401 || e.status == 403) { revoke(); return }
            } catch (_: Exception) { /* An unsuccessful heartbeat must age out on the server. */ }
        }
        val stale = MonitorHealth.lastSuccess == 0L || now - MonitorHealth.lastSuccess >= 15_000
        val label = if (stale) "Нет свежих данных · новых ранее: $count" else "Точка ${c.store} · новых заказов: $count"
        getSystemService(NotificationManager::class.java).notify(7, notification(label))
        // Network work is serial. Alert immediately after fetch; no overlapping polls or playback.
        if (SystemClock.elapsedRealtime() - start > 10_000) MonitorHealth.error = "Медленное соединение. Проверьте очередь."
    }
    private fun heartbeat(c: Credential, monitoring: Boolean) {
        KitchenApi.call("/api/kitchen-device/heartbeat", c.token, JSONObject()
            .put("monitoring", monitoring).put("audio_ready", monitoring && MonitorHealth.audioReady)
            .put("volume", audio.volume).put("connection_ok", MonitorHealth.lastSuccess > 0 && SystemClock.elapsedRealtime() - MonitorHealth.lastSuccess < 15_000)
            .put("app_version", BuildConfig.VERSION_NAME))
    }
    private fun sendStoppedHeartbeat() { credential?.let { try { heartbeat(it, false) } catch (_: Exception) {} } }
    private fun revoke() {
        if (destroyed) return
        MonitorHealth.revoked = true
        vault.enabled = false; vault.clear()
        audio.stop(); schedule.reconcile(false)
        MonitorHealth.error = "Доступ завершён. Войдите в точку заново."
        stopSelf()
    }
    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, KitchenMonitorService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_kitchen).setContentTitle("Я@Ша · мониторинг кухни")
            .setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Остановить", stop).build()).build()
    }
    override fun onDestroy() {
        destroyed = true
        MonitorHealth.running = false
        MonitorHealth.audioReady = false
        timer.removeCallbacksAndMessages(null)
        getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback)
        task?.cancel(true); executor.shutdownNow()
        audio.stop()
        wakeLock?.let { if (it.isHeld) it.release() }
        MonitorHealth.running = false
        MonitorHealth.lastSuccess = 0L
        super.onDestroy()
    }
    companion object {
        const val CHANNEL = "kitchen-monitor"
        fun channel(context: android.content.Context) {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Мониторинг кухни", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) })
        }
    }
}

package ru.yasha.kitchen

import android.Manifest
import android.annotation.SuppressLint
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.net.http.SslError
import android.os.*
import android.provider.Settings
import android.view.WindowManager
import android.view.WindowInsets
import android.widget.FrameLayout
import android.webkit.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.time.Instant
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var refresh: KitchenRefreshLayout
    private lateinit var vault: KitchenVault
    private lateinit var audio: KitchenAudio
    private val network = Executors.newSingleThreadExecutor()
    private var lastCookie: String? = null
    private var binding = false
    private var generation = 0
    private var startRequested = false
    private var resumeAfterBind = false
    private var refreshApproved = false
    private var refreshPending = false
    private val main = Handler(Looper.getMainLooper())
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) prepareStart() else {
            MonitorHealth.error = "Без разрешения на уведомления мониторинг не включён."
            AlertDialog.Builder(this).setTitle("Разрешите уведомления кухни")
                .setMessage("Мониторинг должен оставаться видимым в Android. Разрешите уведомления в настройках приложения, затем включите мониторинг снова.")
                .setPositiveButton("Настройки") { _, _ -> startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)) }
                .setNegativeButton("Позже", null).show()
        }
    }
    private fun sameOrigin(uri: Uri): Boolean {
        val origin = Uri.parse(BuildConfig.KITCHEN_ORIGIN)
        return uri.scheme == origin.scheme && uri.host == origin.host && uri.port == origin.port
    }
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })
        vault = KitchenVault(this)
        audio = KitchenAudio(this)
        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsBeforeUnload(view: WebView, url: String, message: String, result: JsResult): Boolean {
                if (!sameOrigin(Uri.parse(url))) { result.cancel(); return true }
                if (refreshApproved) { refreshApproved = false; result.confirm(); return true }
                AlertDialog.Builder(this@MainActivity).setTitle("Есть несохранённые изменения")
                    .setMessage("Покинуть страницу и потерять изменения?")
                    .setPositiveButton("Продолжить") { _, _ -> result.confirm() }
                    .setNegativeButton("Остаться") { _, _ -> finishRefresh(); result.cancel() }
                    .setOnCancelListener { finishRefresh(); result.cancel() }.show()
                return true
            }
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                if (!sameOrigin(Uri.parse(url))) { result.cancel(); return true }
                AlertDialog.Builder(this@MainActivity).setTitle("Подтверждение")
                    .setMessage(message)
                    .setPositiveButton("Подтвердить") { _, _ -> result.confirm() }
                    .setNegativeButton("Отмена") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }.show()
                return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
        WebViewCompat.addWebMessageListener(web, "YashaKitchen", setOf(BuildConfig.KITCHEN_ORIGIN)) { _, message, source, mainFrame, reply ->
            if (!mainFrame || !sameOrigin(source)) return@addWebMessageListener
            try {
                when (JSONObject(message.data ?: "{}").optString("action")) {
                    "state" -> { bindIfChanged(); if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply.postMessage(health().toString()) }
                    "start" -> { startRequested = true; bindIfChanged(); prepareStart() }
                    "stop" -> stopMonitoring()
                    "test" -> testSound()
                    "settings" -> startActivity(Intent(Settings.ACTION_SOUND_SETTINGS))
                    "logout" -> {
                        generation++; lastCookie = null; stopMonitoring(); vault.clear()
                        MonitorHealth.revoked = false
                        MonitorHealth.error = "Войдите в точку, чтобы включить уведомления."
                    }
                    "session-changed" -> bindIfChanged(true)
                }
            } catch (_: Exception) { MonitorHealth.error = "Не удалось выполнить действие. Откройте кухню заново." }
        }
        } else {
            AlertDialog.Builder(this).setMessage("Обновите Android System WebView для безопасного входа в кухню.")
                .setPositiveButton("Закрыть") { _, _ -> finish() }.setCancelable(false).show()
            return
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (sameOrigin(request.url)) return false
                if (request.isForMainFrame && request.url.scheme in setOf("https", "http", "mailto", "tel")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: ActivityNotFoundException) {}
                }
                return true
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.scheme in setOf("https", "http") && !sameOrigin(request.url)) {
                    return WebResourceResponse("text/plain", "UTF-8", 403, "External resource blocked", emptyMap(), ByteArrayInputStream(byteArrayOf()))
                }
                return super.shouldInterceptRequest(view, request)
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) { handler.cancel() }
            override fun onPageFinished(view: WebView, url: String) {
                finishRefresh()
                if (sameOrigin(Uri.parse(url))) bindIfChanged()
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame || isFinishing) return
                finishRefresh()
                AlertDialog.Builder(this@MainActivity).setTitle("Не удалось открыть кухню")
                    .setMessage(if (MonitorHealth.running) "Мониторинг продолжает работать с последним состоянием. Проверьте интернет и обновите страницу." else "Проверьте интернет. Мониторинг выключен; заказы могут продолжать поступать.")
                    .setPositiveButton("Повторить") { _, _ -> web.loadUrl(BuildConfig.KITCHEN_ORIGIN + "/kitchen") }
                    .setNeutralButton("Проверить мониторинг") { _, _ -> startRequested = true; prepareStart() }
                    .setNegativeButton("Закрыть", null).show()
            }
        }
        val root = FrameLayout(this)
        refresh = KitchenRefreshLayout(this, web)
        refresh.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        refresh.setOnRefreshListener { refreshInterface() }
        root.addView(refresh, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        setContentView(root)
        web.loadUrl(BuildConfig.KITCHEN_ORIGIN + "/kitchen")
        if (!MonitorHealth.running) vault.enabled = false
    }
    private val refreshTimeout = Runnable { finishRefresh() }
    private fun finishRefresh() {
        main.removeCallbacks(refreshTimeout)
        refreshPending = false
        refreshApproved = false
        if (::refresh.isInitialized) refresh.isRefreshing = false
        web.settings.cacheMode = WebSettings.LOAD_DEFAULT
    }
    private fun refreshInterface() {
        val url = web.url
        if (refreshPending || url == null || !sameOrigin(Uri.parse(url))) { refresh.isRefreshing = false; return }
        refreshPending = true
        // Ask existing unsaved-change guards. Conservatively protect visible forms
        // too, including older hosted versions without a beforeunload handler.
        web.evaluateJavascript("""
            (() => {
              const event = new Event('beforeunload', {cancelable: true});
              window.dispatchEvent(event);
              return event.defaultPrevented || !!document.querySelector('form');
            })()
        """.trimIndent()) { needsConfirmation ->
            if (isFinishing || isDestroyed || web.url != url) { finishRefresh(); return@evaluateJavascript }
            val reload = {
                refreshApproved = true
                // Revalidate the HTML/assets without deleting cookies or local data.
                web.settings.cacheMode = WebSettings.LOAD_NO_CACHE
                main.postDelayed(refreshTimeout, 15_000)
                web.reload()
            }
            if (needsConfirmation == "true") {
                AlertDialog.Builder(this).setTitle("Обновить интерфейс?")
                    .setMessage("На странице есть форма или несохранённые изменения. При обновлении введённые данные могут быть потеряны. Уведомления кухни продолжат работать.")
                    .setPositiveButton("Обновить") { _, _ -> reload() }
                    .setNegativeButton("Остаться") { _, _ -> finishRefresh() }
                    .setOnCancelListener { finishRefresh() }.show()
            } else reload()
        }
    }
    private fun bindIfChanged(forceSwitch: Boolean = false) {
        if (forceSwitch) {
            generation++; lastCookie = null; stopMonitoring(); vault.clear()
        }
        if (binding) return
        val cookies = CookieManager.getInstance().getCookie(BuildConfig.KITCHEN_ORIGIN + "/api/") ?: ""
        val session = cookies.split(';').map { it.trim() }.firstOrNull { it.startsWith("staff_session=") }
        // The scoped native credential outlives short web sessions. Reopening the
        // WebView or renewing its cookie must not interrupt alerts during an outage.
        // Explicit login/store switching clears it above; the server checks every feed.
        val saved = vault.read()
        if (!forceSwitch && saved != null && saved.until > System.currentTimeMillis()) { lastCookie = session; return }
        // No cookie values are sent over the bridge or written to logs.
        if (session == lastCookie) return
        lastCookie = session
        generation++
        val requestGeneration = generation
        val wasMonitoring = MonitorHealth.running || startRequested || resumeAfterBind
        resumeAfterBind = wasMonitoring
        stopMonitoring(false)
        vault.clear()
        if (session == null) return
        binding = true
        network.execute {
            try {
                val result = KitchenApi.call("/api/kitchen-device/native-token", body = JSONObject(), cookie = cookies)
                val c = Credential(result.getString("token"), result.getLong("store_id"), Instant.parse(result.getString("expires_at")).toEpochMilli())
                main.post {
                    binding = false
                    if (requestGeneration == generation) {
                        vault.save(c)
                        MonitorHealth.revoked = false
                        MonitorHealth.error = "Уведомления выключены. Включите их перед сменой."
                        if (wasMonitoring) { resumeAfterBind = false; startRequested = true; prepareStart() }
                    }
                }
            } catch (e: Exception) {
                main.post {
                    binding = false
                    if (requestGeneration == generation) {
                        if (e !is ApiFailure || e.status >= 500) lastCookie = null // Retry transport failures, not a personal login.
                        MonitorHealth.error = if (e is ApiFailure && e.status == 403) "Для уведомлений войдите общим логином точки." else "Нет доступа к уведомлениям. Проверьте связь и вход."
                    }
                }
            }
        }
    }
    private fun health(): JSONObject {
        val c = vault.read()
        val connected = MonitorHealth.lastSuccess > 0 && SystemClock.elapsedRealtime() - MonitorHealth.lastSuccess < 15_000
        return JSONObject().put("monitoring", MonitorHealth.running).put("audio_ready", if (MonitorHealth.running) MonitorHealth.audioReady else vault.tested && !audio.failed && audio.volume > 0)
            .put("volume", audio.volume).put("authenticated", c != null && c.until > System.currentTimeMillis())
            .put("connection_ok", connected).put("error", MonitorHealth.error).put("revoked", MonitorHealth.revoked)
    }
    private fun prepareStart() {
        if (binding) return
        val c = vault.read()
        if (c == null || c.until <= System.currentTimeMillis()) { MonitorHealth.error = "Войдите общим логином точки на подтверждённом устройстве."; return }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS); return
        }
        if (!getSystemService(NotificationManager::class.java).areNotificationsEnabled()) {
            MonitorHealth.error = "Разрешите уведомления приложения в настройках Android."
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)); return
        }
        val power = getSystemService(PowerManager::class.java)
        if (!power.isIgnoringBatteryOptimizations(packageName)) {
            AlertDialog.Builder(this).setTitle("Работа при заблокированном экране")
                .setMessage("Разрешите кухне работать без оптимизации батареи. Затем снова нажмите «Включить уведомления кухни». На этом планшете также нужно проверить Wi-Fi во сне.")
                .setPositiveButton("Открыть настройки") { _, _ ->
                    startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
                }.setNegativeButton("Позже", null).show()
            return
        }
        if (audio.volume == 0) { MonitorHealth.error = "Увеличьте громкость будильника и выполните проверку звука."; testSound(); return }
        if (!vault.tested) { testSound(); return }
        vault.enabled = true
        startRequested = false
        try { startForegroundService(Intent(this, KitchenMonitorService::class.java)) }
        catch (_: Exception) { vault.enabled = false; MonitorHealth.error = "Android не разрешил запуск. Откройте приложение и включите уведомления снова." }
    }
    private fun testSound() {
        if (MonitorHealth.running) { MonitorHealth.error = "Проверяйте звук перед включением мониторинга; текущие заказы продолжают звучать."; return }
        audio.play()
        AlertDialog.Builder(this).setTitle("Проверка динамика")
            .setMessage("Вы слышали сигнал именно из динамика планшета? Проверьте громкость будильника, Bluetooth и режим «Не беспокоить».")
            .setPositiveButton("Да, слышу") { _, _ ->
                vault.tested = !audio.failed && audio.volume > 0
                audio.stop()
                if (startRequested && vault.tested) prepareStart()
            }.setNegativeButton("Нет") { _, _ -> vault.tested = false; audio.stop(); startActivity(Intent(Settings.ACTION_SOUND_SETTINGS)) }
            .setOnCancelListener { audio.stop() }.show()
    }
    private fun stopMonitoring(cancelIntent: Boolean = true) {
        if (cancelIntent) { startRequested = false; resumeAfterBind = false }
        val previous = vault.read()
        vault.enabled = false
        stopService(Intent(this, KitchenMonitorService::class.java))
        if (previous != null && !network.isShutdown) network.execute {
            try { KitchenApi.call("/api/kitchen-device/heartbeat", previous.token, JSONObject()
                .put("monitoring", false).put("audio_ready", false).put("volume", audio.volume)
                .put("connection_ok", false).put("app_version", BuildConfig.VERSION_NAME)) } catch (_: Exception) {}
        }
        MonitorHealth.error = "Уведомления выключены. Приём заказов продолжается."
    }
    override fun onResume() { super.onResume(); window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    override fun onPause() { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); CookieManager.getInstance().flush(); super.onPause() }
    override fun onDestroy() { main.removeCallbacks(refreshTimeout); generation++; audio.stop(); network.shutdownNow(); web.destroy(); super.onDestroy() }
}

package ru.yasha.kitchen

import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.webkit.WebView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import kotlin.math.abs

/** Only intercept a downward pull that began at the top of the touched scroll area. */
class KitchenRefreshLayout(context: Context, private val web: WebView) : SwipeRefreshLayout(context) {
    private var eligible = false
    private var starting = false
    private var gesture = 0
    private var startX = 0f
    private var startY = 0f
    private val slop = ViewConfiguration.get(context).scaledTouchSlop

    init {
        // SwipeRefreshLayout must see DOWN to initialise its pointer tracking.
        // It cannot intercept that event; subsequent moves wait for the DOM check.
        setOnChildScrollUpCallback { _, _ -> (!starting && !eligible) || web.canScrollVertically(-1) }
        setColorSchemeColors(android.graphics.Color.rgb(93, 107, 75))
        setDistanceToTriggerSync((88 * resources.displayMetrics.density).toInt())
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val current = ++gesture
                eligible = false
                startX = event.x
                startY = event.y
                if (!isRefreshing && web.width > 0 && web.height > 0) {
                    val x = (event.x / web.width).coerceIn(0f, 1f)
                    val y = (event.y / web.height).coerceIn(0f, 1f)
                    // Fixed script and numeric coordinates only; no credentials or URLs.
                    web.evaluateJavascript("""
                        (() => {
                          if (window.scrollY > 1 || document.querySelector('dialog[open], [aria-modal="true"]')) return false;
                          const target = document.elementFromPoint($x * innerWidth, $y * innerHeight);
                          if (!target || target.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')) return false;
                          if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return false;
                          for (let node = target; node; node = node.parentElement) {
                            if (node.scrollTop > 1) return false;
                          }
                          return true;
                        })()
                    """.trimIndent()) { result ->
                        if (current == gesture) eligible = result == "true"
                    }
                }
            }
            MotionEvent.ACTION_MOVE -> {
                if (abs(event.x - startX) > slop && abs(event.x - startX) > abs(event.y - startY)) {
                    gesture++; eligible = false
                }
            }
            MotionEvent.ACTION_POINTER_DOWN -> { gesture++; eligible = false }
        }
        starting = event.actionMasked == MotionEvent.ACTION_DOWN
        val handled = super.dispatchTouchEvent(event)
        starting = false
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            gesture++; eligible = false
        }
        return handled
    }
}

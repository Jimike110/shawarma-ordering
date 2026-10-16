package ru.yasha.kitchen

/** Monotonic times; failed fetches deliberately preserve the last confirmed pending state. */
class AlertSchedule {
    @Volatile var pending: Boolean = false
        private set
    private var playedAt: Long? = null
    @Synchronized fun reconcile(hasNew: Boolean) { pending = hasNew; if (!hasNew) playedAt = null }
    @Synchronized fun due(now: Long, playing: Boolean): Boolean = pending && !playing && (playedAt == null || now - playedAt!! >= 15_000)
    @Synchronized fun played(now: Long) { playedAt = now }
}

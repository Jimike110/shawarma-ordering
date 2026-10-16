package ru.yasha.kitchen

import org.junit.Assert.*
import org.junit.Test

class AlertScheduleTest {
    @Test fun existingOrdersRepeatWithoutOverlapAndStopOnConfirmation() {
        val state = AlertSchedule()
        state.reconcile(true)
        assertTrue(state.due(0, false))
        state.played(0)
        assertFalse(state.due(14_999, false))
        assertFalse(state.due(15_000, true))
        assertTrue(state.due(15_000, false))
        // No response during an outage leaves known pending orders sounding.
        assertTrue(state.due(30_000, false))
        state.reconcile(false)
        assertFalse(state.due(30_001, false))
        state.reconcile(true)
        assertTrue(state.due(30_002, false))
    }
}

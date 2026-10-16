package ru.yasha.kitchen

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.os.Build

class RecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        val vault = KitchenVault(context)
        if (!vault.enabled) return
        // Do not promise a restart Android may prohibit. A person must verify audio again.
        vault.enabled = false
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        KitchenMonitorService.channel(context)
        val open = PendingIntent.getActivity(context, 2, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        context.getSystemService(NotificationManager::class.java).notify(8, Notification.Builder(context, KitchenMonitorService.CHANNEL)
            .setSmallIcon(R.drawable.ic_kitchen).setContentTitle("Включите уведомления кухни")
            .setContentText("После перезапуска откройте кухню и проверьте звук.").setContentIntent(open).setAutoCancel(true).build())
    }
}

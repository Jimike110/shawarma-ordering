# Private kitchen Android app

This Kotlin app loads the existing React kitchen over the **one HTTPS origin compiled into the APK**. Native code monitors the minimal order feed and plays the bundled kitchen recording. It contains no shop password or backend secret. It requires the matching backend migrations and APIs; installing the APK does not deploy them.

## Build and sign

From the repository root in PowerShell, with Docker Desktop running:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-kitchen-apk.ps1 -Origin https://your-business.example
```

Replace the example with the actual business origin. The script downloads the Android toolchain into Docker storage, runs JVM tests and Android lint, and produces a signed release under ignored `artifacts/android/`. It creates a local trial signing key only if none exists. The key/password remain under ignored `artifacts/android-signing/`; restrict access and keep an **encrypted independent backup**. Never commit them, send them with the APK or regenerate them for an update. Increase `-VersionCode` for every update; `-VersionName` is the visible version.

For Android Studio: open this directory, use JDK 21 and the bundled Gradle 8.14.3 wrapper, install SDK 36 and build-tools 36.0.0, and set `-PkitchenOrigin=...`. Minimum Android is 8.0/API 26. Release signing reads `KITCHEN_KEYSTORE_FILE` and `KITCHEN_KEYSTORE_PASSWORD_FILE` (paths, not secret values). No signing details belong in tracked Gradle properties. The build copies the existing MP3 from `../public/audio/`; preserve its [credits](../public/audio/CREDITS.md).

An installed Windows toolchain can use the same signing/export helper without Docker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-kitchen-apk.ps1 -Origin https://your-business.example -InstalledGradle 'E:\tools\gradle\bin\gradle.bat' -JavaHome 'C:\Program Files\Java\jdk-21' -AndroidSdk 'E:\Android\Sdk'
```

Use your actual installed paths and Gradle 8.13–8.14.x. `GRADLE_USER_HOME` can point to a cache on a roomy drive. The SDK/cache paths above are examples, not required installation locations. This app uses the API-36-compatible Android Gradle Plugin 8.11.0 and Kotlin 2.1.20; it does not require upgrading other projects' toolchains.

`-Offline` is available for an installed toolchain after all dependencies are cached. Exports include a `.sha256` file. The demonstration-origin build requires the new device APIs to be released together with the web app; it must not be represented as ready for real kitchen use before that deployment and physical acceptance.

## Install and approve a tablet

1. Verify the APK signature/checksum through a trusted channel. Transfer the signed APK privately and allow installation from that source temporarily. Keep the same package/signature for updates. Prefer a dedicated, patched business tablet with screen lock and physical access control.
2. Open the app and enter the store's shared credentials and an identifiable device label. Compare the pairing code with **Сотрудники → Кухни и устройства** in the owner's dashboard. Only the owner approves it. New enrollments expire after ten minutes.
3. Entering a shared kitchen starts monitoring automatically once its credential is ready. On first setup, grant notification permission, allow battery-optimization exemption, check alarm volume, and positively confirm the test sound from the tablet speaker. If setup is incomplete, use **«Включить звук»** to continue. Check Bluetooth routing and Do Not Disturb. The app does not override these settings silently. After logout/login, these device checks are retained and monitoring starts again; a deliberate stop is respected for the current visit.
4. Verify the selected address, queue, visible Android monitoring notification and owner coverage. Keep the tablet charged and its connection stable. The app keeps the screen awake only while foregrounded.
5. Repeat a real new-order test with the screen locked and another app foregrounded. Android/vendor power settings must be tested on this particular tablet. A foreground service alone does not bypass Doze. See [Android power guidance](https://developer.android.com/training/monitoring-device-state/doze-standby).

An approved tablet can move to another store: **«Выйти / сменить точку»**, then enter that store's shared credentials. Approval is business-wide; store access is not. Switching invalidates that device's previous store sessions and alert token. Other tablets remain signed in. Login expires 30 days after authentication; refreshing a short session never moves that deadline.

After reboot/update, open the app and check monitoring again; the receiver requests human recovery rather than promising Android will always restart a service. Force-stop, lost power/network, disabled notifications, silent audio or vendor restrictions can prevent an alert. Reopen the app and use the test sound after any such event. Customer notifications are not implemented.

### Refreshing after a web release

From APK 1.0.1, pull down from the top of the page or a queue lane to reload the current hosted interface. It bypasses the WebView cache for that load without clearing login cookies, baskets or browser history. A scrolled lane must first return to its top; horizontal gestures, controls and open dialogs do not trigger refresh. Forms/unsaved-change guards require confirmation before reload, since unsaved fields may be lost.

Native order monitoring continues independently during refresh. The gesture retrieves a web release only after that release is deployed successfully; it cannot update Kotlin code, Android permissions or the APK itself. Those changes require installing a newer APK signed with the original key. Keep frontend/API releases compatible with installed APK versions.

## Monitoring and security contract

- Visible foreground service starts while the kitchen app is foregrounded after shared login/setup, or through the sound control. It uses `specialUse` with the continuous kitchen-monitoring purpose declared in the manifest. It is not labelled media playback or unlimited data sync. See [service types](https://developer.android.com/develop/background-work/services/fgs/service-types).
- Serial feed requests every five seconds after completion; existing new orders ring immediately after the response. A separate monotonic timer repeats at 15 seconds without overlapping playback, including known new orders during an outage. A successful empty/new-free feed stops it. Starting preparation/cancelling on another device clears it at refresh.
- Heartbeats every 15 seconds; connection stale at 15 seconds, owner device offline at 60 seconds. Coverage describes software checks, **not proof a person heard a sound**. Device failures do not stop order intake.
- Only the configured origin receives the main-frame message bridge. External HTTPS links open outside the privileged WebView. No file/content access, mixed content, third-party cookies, ignored TLS errors or arbitrary JS-to-native URLs. Release WebView debugging is disabled.
- HttpOnly staff/device cookies stay outside JavaScript. Native alert credentials are AES-GCM encrypted using Android Keystore, excluded from backup, restricted to feed/heartbeat and never passed into URLs/JS. They cannot read full orders or perform business actions. Revocation is enforced by PostgreSQL on every request; the service clears its credential and stops on denial.
- Logs/notifications contain no customer names, comments, private receipt links or tokens. Do not enable HTTP body/cookie logging during support.

## Trial acceptance on the actual Teclast

Do not declare the trial ready from desktop emulation alone. Record the tablet's Android/WebView versions, CSS viewport (`innerWidth/innerHeight`), Android display/font scaling and app version locally. Test both orientations and a complete operating-day soak with isolated orders. Under healthy connectivity, verify new orders ring and attended orders stop within ten seconds; check startup with pending orders and 15-second repetition.

Also test locked screen/another app, Doze/battery exemption, low/zero alarm volume, Bluetooth, Wi-Fi/LTE changes, outage/reconnection, reboot/update, concurrent devices, store switching, owner password rotation/revocation and the 30-day boundary. Confirm zero-connected-device warnings without automatic intake suspension. Retain local evidence under `artifacts/`; actual physical-device acceptance and owner menu/branding approval remain release prerequisites.

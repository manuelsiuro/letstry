# Android APK build — Cosmic Pizza Delivery

This project ships as a Capacitor-wrapped Android app. The web bundle is the
single source of truth — `npm run build` produces `dist/`, then Capacitor
copies it into the Android project.

## Prerequisites

- **Android Studio** (latest stable). Install from
  <https://developer.android.com/studio>.
- **JDK 17** (Android Studio bundles its own, but a system JDK works too).
- **Android SDK** API 34 or newer, installed via the SDK Manager.
- `ANDROID_HOME` env var pointing at your SDK path (commonly
  `~/Library/Android/sdk` on macOS).

## First-time setup

```bash
# 1. Install deps (already done if you've run npm install).
npm install

# 2. Generate the android/ directory. Run once.
npm run android:add

# 3. Build the web bundle and sync into android/.
npm run cap:sync

# 4. Open Android Studio. Gradle will resolve dependencies on first open.
npm run android:open
```

## Debug APK

```bash
npm run cap:sync     # rebuild web bundle + copy into android/
npm run android:build
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a device:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Release APK (signed) — outline

Out of scope for the initial milestone, but the steps are:

1. Generate a keystore:
   ```bash
   keytool -genkey -v -keystore release.keystore -alias cpd \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Add signing config to `android/app/build.gradle` (`signingConfigs.release`).
3. Build:
   ```bash
   cd android && ./gradlew assembleRelease
   ```
4. Output: `android/app/build/outputs/apk/release/app-release.apk`.
5. Optional: build an Android App Bundle for the Play Store:
   ```bash
   cd android && ./gradlew bundleRelease
   ```

Keep the keystore **out of git** — store it in a secrets manager and reference
the path via `~/.gradle/gradle.properties`.

## Troubleshooting

- **Blank screen on launch**: confirm `webDir` in `capacitor.config.ts` matches
  the Vite build output (`dist`) and that `vite.config.ts` sets `base: "./"`.
  Capacitor serves the bundle from `file://` and absolute paths break.
- **Save not persisting after app close**: native storage uses
  `@capacitor/preferences`; the web mirror is hydrated on boot in `main.ts`.
  Check that `hydrate([...])` runs before `loadSaved()`.
- **Status bar overlaps HUD**: `index.html` already has `viewport-fit=cover`
  and `#hud-root` honors `env(safe-area-inset-*)`. If a new top-level element
  is added, give it the same padding.
- **No haptics on tap**: haptics call from `hud.ts` is gated on
  `Capacitor.isNativePlatform()`; it's silently no-op in the browser. On
  Android, ensure the device has vibration enabled.

# Android build

Amour uses Capacitor 8 around the existing React renderer. Package ID:
`su.xokeza.amour`. Account API: `https://xokeza.su/amour/api`.

The Android build is separate from Electron: `vite.mobile.config.ts` produces
`dist-android/`, so it cannot replace a desktop renderer/update bundle. Native HTTP
handles catalog requests. Sessions are encrypted with AES-GCM using a key in Android
Keystore; the plaintext session is not persisted in WebView localStorage. Existing
desktop storage keys, session migration and databases are unchanged.

## Build

Requires JDK 21, Android SDK platform 36 and build tools, with SDK licenses accepted.
The build helper can select an installed SDKMAN JDK 21 if the active JDK is incompatible.

```sh
pnpm install --frozen-lockfile
pnpm android:build
```

`ANDROID_HOME` or `ANDROID_SDK_ROOT` can override the default `~/Android/Sdk`.
The signed release APK is `release/Amour-<version>-android.apk`.

On first release build the helper generates a signing key outside the repository:
`~/.local/share/amour/android-signing/`. Preserve this entire private directory for
future updates. Losing the key prevents signing compatible updates. Signing
credentials are neither printed nor embedded in the app.

For local debugging only:

```sh
pnpm android:sync
node scripts/build-android.mjs --debug
```

`AMOUR_ANDROID_SMOKE=1 pnpm exec cap sync android` enables WebView inspection in a
temporary test build. Run `cap sync android` without that flag and rebuild before
shipping. Published APKs must have WebView debugging disabled.

## Native behavior

- Android back closes a dialog, navigates back, or minimizes the app.
- Window close/maximize/minimize buttons are hidden.
- Login and mini-player layouts fit phone widths and respect safe-area insets.
- App backups exclude credentials; reinstall/update with the same signing key keeps
  the encrypted session.
- Desktop-specific overlays, window integrations and Electron file import are not
  native Android features. Background playback behavior still needs device testing.

Use an explicit `adb -s <device-id>` for verification. Do not install on another
connected device or read unrelated device data.

## Mobile layout and compatible updates (0.2.18)

Native Android uses `features/navigation/ui/MobileNavigation.tsx` and
`features/player/ui/MobilePlayer.tsx`, with bottom tabs and independent mini/full
players. Desktop navigation and player layouts are preserved. Touch track selection
plays immediately; Android back closes the player/search before leaving the page.
The settings dialog uses a native section picker rather than a desktop sidebar.
`android.captureInput` is disabled: normal Android IME composition and deletion are
used instead of Capacitor's alternative key capture.

For this existing installation, the original debug signing certificate matched the
locally available debug key. A signing lineage upgrades it to the private release
key without deleting the installed package or its data. The lineage stays beside
the release signing key; preserve the old debug keystore for builds that support
older Android versions. New clean projects do not need this migration.

```sh
# Only for migrating an installation made with this machine's original debug key:
AMOUR_ANDROID_ROTATE_DEBUG=1 node scripts/build-android.mjs
```

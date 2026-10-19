# mobile-review — review checklist

Derived from ../SKILL.md. Read by `code-reviewer`, `workload-reviewer`, `security-reviewer` and `rollout-reviewer` through the `change-review` skill when a diff touches an iOS, Android, Flutter, React Native or Kotlin Multiplatform app (defects in a diff; silences and trade-offs in a design or spec review), and by `grilling` (trade-offs). Items from "## Secure storage and secrets in the binary", "## Deep links and universal or app links" and "## WebView" go to `security-reviewer`; items from "## Forced update and old app versions" and "## Store rules that block release" to `rollout-reviewer`; items from "## Offline and flaky networks", "## Battery and background work", "## App size and startup time" and the ANR item to `workload-reviewer`; the rest to `code-reviewer`. When a language standard id already covers the line (`kt-*`, `swift-*`, `dart-*`), report that id instead of the `mobile:` id. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md. Store deadlines were checked on 2026-10-19.

## defects
Objectively checkable in a diff, manifest, `Info.plist`, entitlements or build config. A match is a finding.

- id: mobile:state-lost-on-process-death
  rule: State the user cannot recreate survives system-initiated process death.
  check: Form input, draft, selection or navigation position held only in an Android ViewModel field, a singleton, a SwiftUI @State or a Flutter State with no SavedStateHandle, rememberSaveable, NSUserActivity/@SceneStorage, RestorationMixin or persistent storage behind it.
  section: "## App lifecycle and process death"

- id: mobile:unscheduled-work-after-exit
  rule: Work that must finish runs under a mechanism the OS knows about.
  check: Thread or coroutine started from BroadcastReceiver.onReceive or on backgrounding that must complete (upload, save, sync) with no job/WorkManager handoff on Android, or no background task with an expiration handler on iOS.
  section: "## App lifecycle and process death"

- id: mobile:purpose-string-missing
  rule: Every protected resource has a purpose string that says why.
  check: New use of camera, photos, location, contacts, microphone, Bluetooth, tracking or similar with no matching NS*UsageDescription key in Info.plist, or a purpose string that does not say what the data is used for.
  section: "## Permissions"

- id: mobile:permission-out-of-context
  rule: Ask in context and keep working when refused.
  check: Runtime permission requested at app start or before the feature is used; denial path that blocks the app, loops the prompt or has no fallback (no manual entry, no disabled feature state).
  section: "## Permissions"

- id: mobile:permission-broader-than-needed
  rule: Request the least access that does the job.
  check: New manifest permission or Info.plist usage key with no feature that needs it; full Photos/Contacts access where a picker would do; precise location where coarse suffices; background location for a foreground feature.
  section: "## Permissions"

- id: mobile:ipv4-only
  rule: The app works on an IPv6-only network.
  check: Hard-coded IPv4 address literals in URLs or sockets, IPv4-only socket families, or reachability checks against an IPv4 address.
  section: "## Offline and flaky networks"

- id: mobile:offline-write-lost
  rule: A write the user expects to keep is not lost when the network is down.
  check: Save or submit whose only effect is a network call, with no local write, no queued retry as persistent work, and no message to the user when offline.
  section: "## Offline and flaky networks"

- id: mobile:background-work-unscheduled
  rule: Deferrable work that must survive app exit uses the platform scheduler.
  check: Periodic sync, upload or cleanup done with a background loop, repeating Timer/Handler, long-lived thread or service instead of WorkManager on Android or BGTaskScheduler on iOS.
  section: "## Battery and background work"

- id: mobile:background-exact-timing-assumed
  rule: Background code does not assume exact timing or network access.
  check: Background logic that requires a job or alarm at an exact time or network access at fire time with no handling for deferral; exact alarms where an inexact alarm would do; background pushes planned more often than three per hour on iOS.
  section: "## Battery and background work"

- id: mobile:fgs-type-missing
  rule: Each Android foreground service declares its type.
  check: <service> started as a foreground service with no android:foregroundServiceType or without the matching FOREGROUND_SERVICE_* permission; an iOS UIBackgroundModes entry used for a purpose other than its own.
  section: "## Battery and background work"

- id: mobile:main-thread-startup-work
  rule: Nothing slow runs on the main thread before the first frame.
  check: Disk, network, database migration or SDK initialisation added synchronously to Application.onCreate, a ContentProvider initialiser, application(_:didFinishLaunchingWithOptions:), a static initializer, or Flutter main() before runApp.
  section: "## App size and startup time"

- id: mobile:secret-in-binary
  rule: No secret ships in the app.
  check: API key, client secret, signing key or private credential in source, strings.xml, Info.plist, assets, react-native-config/.env bundled into the app, or a Dart define; obfuscation cited as the protection.
  section: "## Secure storage and secrets in the binary"

- id: mobile:token-outside-keystore
  rule: Credentials and tokens live in the Keychain or Android Keystore.
  check: Access token, refresh token, password or private key written to UserDefaults, SharedPreferences, DataStore without Keystore-backed encryption, Async Storage, shared_preferences or a plain file.
  section: "## Secure storage and secrets in the binary"

- id: mobile:sensitive-in-backup-or-logs
  rule: Sensitive data is excluded from backup and logs.
  check: Tokens or personal data in files covered by backup with no dataExtractionRules/fullBackupContent exclusion; tokens or personal data passed to Log, print, NSLog, os_log public, console.log or a crash reporter breadcrumb.
  section: "## Secure storage and secrets in the binary"

- id: mobile:transport-exception-broad
  rule: Transport exceptions are scoped and justified.
  check: NSAllowsArbitraryLoads true, an NSExceptionDomains entry with no stated reason, android:usesCleartextTraffic="true" or a network security config permitting cleartext beyond named hosts.
  section: "## Secure storage and secrets in the binary"

- id: mobile:deep-link-unvalidated
  rule: Every link parameter is validated and no link performs a destructive action directly.
  check: Handler for a URL scheme, universal link, app link or intent extra that uses parameters without validation, opens arbitrary URLs from them, or deletes, pays, sends or changes account state without a confirmation step.
  section: "## Deep links and universal or app links"

- id: mobile:link-not-verified
  rule: Verified links are actually verified.
  check: New https host in an intent filter without android:autoVerify="true" or without a matching assetlinks.json change; new applinks: entry in Associated Domains with no apple-app-site-association change for that exact subdomain, or an association file served through a redirect.
  section: "## Deep links and universal or app links"

- id: mobile:webview-bridge-exposed
  rule: A JavaScript bridge is never reachable from untrusted content.
  check: addJavascriptInterface, a WKScriptMessageHandler, or a React Native WebView onMessage that performs native actions, on a WebView that can load third-party, user-supplied or non-HTTPS content without removing the bridge or checking the origin first.
  section: "## WebView"

- id: mobile:webview-file-or-url-open
  rule: File access and URL loading are restricted.
  check: setAllowFileAccess(true), setAllowFileAccessFromFileURLs(true) or setAllowUniversalAccessFromFileURLs(true); loadUrl or load(URLRequest) with a URL from a link, intent or server response whose scheme and host are not both allowlisted.
  section: "## WebView"

- id: mobile:privacy-manifest-missing
  rule: Required reason APIs and listed SDKs are declared in a privacy manifest.
  check: New use of a required reason API (file timestamps, system boot time, disk space, active keyboards, UserDefaults) with no NSPrivacyAccessedAPITypes entry in PrivacyInfo.xcprivacy; a new SDK on Apple's list without its own privacy manifest or signature.
  section: "## Store rules that block release"

- id: mobile:sdk-target-below-floor
  rule: The build meets the current SDK and target floors.
  check: Xcode or iOS SDK older than 26 in CI, an iOS deployment target below 13, or an Android targetSdk below 36 for a phone app submitted after 2026-08-31 (extension to 2026-11-01).
  section: "## Store rules that block release"

- id: mobile:data-safety-not-updated
  rule: The Play data safety form changes with the data.
  check: New SDK, data type, or data sharing in an Android app with no note or task to update the Play data safety form.
  section: "## Store rules that block release"

- id: mobile:account-deletion-missing
  rule: Account creation comes with in-app account deletion.
  check: New sign-up flow with no in-app deletion path, deletion that only deactivates, or Sign in with Apple accounts deleted without revoking tokens.
  section: "## Store rules that block release"

- id: mobile:downloaded-native-code
  rule: No downloaded native code changes the app's features.
  check: Code that downloads and loads dex, JAR or .so files, or downloads code that adds or changes features outside the 4.7 categories.
  section: "## Store rules that block release"

- id: mobile:old-client-broken
  rule: A server change keeps every supported app version working.
  check: API change that removes or renames a field, adds a required field, tightens validation or extends a closed enum that installed app versions still read or send, with no minimum-version enforcement covering them; report the matching api-design id.
  section: "## Forced update and old app versions"

- id: mobile:no-min-version-enforcement
  rule: The app has a server-enforced minimum version.
  check: App with a backend API and no client version sent on requests, or no server check that rejects versions below a configured minimum with a response the app turns into an update prompt.
  section: "## Forced update and old app versions"

- id: mobile:crash-symbols-dropped
  rule: Release builds produce symbols that are kept for crash reports.
  check: Build change that disables dSYM generation (DEBUG_INFORMATION_FORMAT not dwarf-with-dsym for release), stops uploading dSYMs or R8 mapping.txt, or runs Flutter --obfuscate without --split-debug-info archived.
  section: "## Crash and ANR reporting"

- id: mobile:main-thread-blocking
  rule: Nothing blocks the main thread long enough to cause an ANR or a hang.
  check: Network, disk, database or heavy computation on the main/UI thread in an input handler, onReceive, Service.onCreate/onStartCommand, or a startForegroundService path that may not call startForeground within 5 seconds.
  section: "## Crash and ANR reporting"

- id: mobile:text-not-scalable
  rule: Text follows the user's text size setting.
  check: Android text sizes in dp or px, or layout sizes in sp; iOS fixed font sizes without a text style or UIFontMetrics; React Native allowFontScaling={false} or a low maxFontSizeMultiplier on content text.
  section: "## Accessibility"

- id: mobile:control-target-or-label
  rule: Controls meet the platform's minimum target and are announced by the screen reader.
  check: Native Android or React Native tappable element smaller than 48x48 dp or 44x44 pt, or with no accessibility label; report swift-ui-a11y, dart-tap-target or dart-semantics-label instead where they apply.
  section: "## Accessibility"

- id: mobile:notification-permission-missing
  rule: Notification permission is requested, in context.
  check: App targeting Android 13+ posting notifications with no POST_NOTIFICATIONS request; notification authorization requested at first launch with no context; the app refusing to work without push.
  section: "## Push notifications"

- id: mobile:push-token-mishandled
  rule: The device token is fetched on every launch and the server drops dead ones.
  check: Client caches the APNs or FCM token and skips registration on later launches; server keeps sending to registrations FCM or APNs reports invalid, or never expires inactive ones.
  section: "## Push notifications"

- id: mobile:sensitive-in-push-payload
  rule: Sensitive data is not sent in the notification payload.
  check: Push payload carrying personal, financial, health or authentication data (codes, tokens) in its visible or data fields.
  section: "## Push notifications"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: mobile:restoration-test-unstated
  rule: A change to restorable state names how it was tested.
  check: Change to saved, restored or navigation state with no mention of a process-death test (Android "Don't keep activities", killing the app from the debugger, a full rebuild for Flutter).
  section: "## App lifecycle and process death"

- id: mobile:offline-behavior-unstated
  rule: The design states each feature's offline behaviour and its conflict rule.
  check: Feature that reads or writes server data with no stated behaviour when offline, and, for local-first writes, no conflict rule for when the device reconnects.
  section: "## Offline and flaky networks"

- id: mobile:perf-claim-unmeasured
  rule: A change that claims faster startup or smaller size gives a release-build number.
  check: Startup or size claim with no release-build measurement (TTID/TTFD, time to first frame, app size report, flutter --analyze-size); a number taken from a debug build.
  section: "## App size and startup time"

- id: mobile:kill-switch-unstated
  rule: A risky feature names how it is turned off in versions already shipped.
  check: Feature whose failure would hurt users or data with no stated remote switch or server-side guard that works on installed versions.
  section: "## Forced update and old app versions"

- id: mobile:rollout-gate-unstated
  rule: A release names the crash and ANR rates that stop the rollout.
  check: Release or rollout plan with no crash and ANR thresholds for halting the phased or staged rollout (Play's bad-behaviour thresholds: 1.09% crashes, 0.47% ANRs, 8% per device).
  section: "## Crash and ANR reporting"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: mobile:offline-write-strategy
  rule: Online-only, queued or lazy writes.
  options: online-only (simple, tells the user at once, nothing works offline) | queued (survives offline, failure is not reported, suits analytics and logs) | lazy local-first (keeps critical user data, needs a conflict rule)
  section: "## Offline and flaky networks"

- id: mobile:baseline-profiles
  rule: Ship Baseline Profiles or not.
  options: ship them (about 30% faster code execution from first launch, needs a generation step and Macrobenchmark setup) | skip (no build cost, slower first runs until the runtime compiles hot code)
  section: "## App size and startup time"

- id: mobile:keychain-device-only
  rule: Keychain items that migrate or stay on the device.
  options: ThisDeviceOnly (a token does not move with a backup, users sign in again on a new device) | migrating class (seamless device change, the credential travels with the backup)
  section: "## Secure storage and secrets in the binary"

- id: mobile:ota-updates
  rule: Over-the-air JavaScript or Dart updates.
  options: OTA bundle (fast fixes without review, must not add or change features, store version no longer matches what runs) | store releases only (reviewed and consistent, fixes wait for review and user updates)
  section: "## Store rules that block release"

- id: mobile:blocking-or-flexible-update
  rule: Blocking or flexible update.
  options: blocking only for security-critical releases (users accept it when used, old clients linger longer) | blocking often (API can drop old clients sooner, users who cannot update now are locked out) | flexible only (no lockout, no guarantee old versions leave)
  section: "## Forced update and old app versions"

- id: mobile:background-push-or-fetch
  rule: Background push or scheduled fetch for fresh content.
  options: background push (no polling, system decides launch time and rate-limits above three per hour) | BGAppRefreshTask/WorkManager periodic (no server work, runs when the system chooses)
  section: "## Push notifications"

---
name: mobile-review
description: Use when a change touches an iOS, Android, Flutter, React Native or Kotlin Multiplatform app — app lifecycle, process death and state restoration, runtime permissions and purpose strings, offline behaviour, background work (WorkManager, BGTaskScheduler, foreground services, alarms), app size and startup time, Keychain or Keystore storage and secrets in the binary, deep links and universal or app links, WebViews, privacy manifests, required reason APIs, the Play data safety form, target SDK deadlines, forced update and API compatibility with old installed versions, phased or staged rollout, crash and ANR reporting, Dynamic Type, TalkBack or VoiceOver, and push notifications.
metadata:
  namespaces: [practice]
---

# Mobile Review

Judgment criteria for the platform concerns of a mobile app that no language
standard owns. A mobile app runs on a device the team does not control: the
OS kills it when it is not visible, the network drops, the store decides
whether a build ships, and old versions keep running for months after a
release. Sources were opened on 2026-10-19; store deadlines are stated with
their dates and must be rechecked after that day.

Routing. Language-level items stay in the language standards and are linked,
never repeated here: `swift-patterns/references/review-standard.md`
(`swift-ui-a11y`, Keychain house style), `kotlin-patterns/references/review-standard.md`
(`kt-ui-collect`, `kt-compose-collect`, `kt-vm-context`, `kt-vm-launches`,
`kt-security-routing`), `flutter-patterns/references/review-standard.md`
(`dart-lifecycle`, `dart-named-routes`, `dart-global-errors`,
`dart-semantics-label`, `dart-tap-target`, `dart-security-routing`) and
`compose-multiplatform-patterns` (state and effects in Compose). A Kotlin
Multiplatform app is reviewed against both the Android and the iOS rules
below for each platform it ships. Visual and cognitive judgment is
`human-interface-guidelines`. Personal data, consent and analytics SDKs are
`privacy-review`; timeouts and retries in general are `resilience-patterns`;
breaking API changes are `api-design`; feature flags and rollback are
`ops-readiness`. Security items (storage, secrets, deep links, WebView,
transport) go to `security-reviewer`; old-version, forced-update and rollout
items to `rollout-reviewer`; background work, offline, startup and ANR items to
`workload-reviewer`; the rest to `code-reviewer`.

## App lifecycle and process death

The OS terminates a backgrounded app to reclaim memory, and the user expects
to return to the same screen with the same input
(https://developer.android.com/topic/libraries/architecture/saving-states,
https://developer.apple.com/documentation/uikit/restoring-your-app-s-state).
Android's core quality criteria require the app to preserve and restore user
state, including editable fields, when it leaves the foreground
(State_Preservation, https://developer.android.com/docs/quality-guidelines/core-app-quality).

**[defect] State the user cannot recreate survives system-initiated process
death.** An Android `ViewModel` survives a configuration change but not
process death; `SavedStateHandle`, `rememberSaveable` or persistent storage do
(https://developer.android.com/topic/libraries/architecture/saving-states).
On iOS 13 and later each scene saves its state in an `NSUserActivity`
(https://developer.apple.com/documentation/uikit/restoring-your-app-s-state);
SwiftUI offers `@SceneStorage`
(https://developer.apple.com/documentation/swiftui/scenestorage). Flutter
serializes restoration data through `RestorationManager` and
`RestorationMixin` before the OS terminates the app
(https://api.flutter.dev/flutter/services/RestorationManager-class.html). A
form draft, a half-finished checkout or a navigation position held only in
memory is lost. Collection and ViewModel scoping are in `kt-vm-launches`,
`kt-ui-collect` and `dart-lifecycle`.

**[defect] Work that must finish runs under a mechanism the OS knows about.**
A thread started from `BroadcastReceiver.onReceive` dies with the process once
the receiver returns, because the system no longer considers the process
needed; schedule a job instead
(https://developer.android.com/guide/components/activities/process-lifecycle).
On iOS, work continued after backgrounding gets a limited time and the app is
terminated if it does not end the task before the limit
(https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app).

**[silence] A change to restorable state names how it was tested.** Flutter's
documentation tests restoration on Android with the developer option "Don't
keep activities" and warns that hot reload state is not persisted
(https://api.flutter.dev/flutter/services/RestorationManager-class.html).

## Permissions

**[defect] Every protected resource has a purpose string that says why.** On
Apple platforms a missing purpose string makes access fail and may crash the
app (https://developer.apple.com/documentation/uikit/requesting-access-to-protected-resources);
App Review requires purpose strings that clearly and completely describe the
use (App Review Guidelines 5.1.1(ii),
https://developer.apple.com/app-store/review/guidelines/).

**[defect] Ask in context and keep working when refused.** Android asks for a
permission when the user starts the feature that needs it, never blocks the
user, and degrades gracefully on denial or revocation
(https://developer.android.com/training/permissions/requesting). App Review
forbids forcing consent to unnecessary access and asks for an alternative,
such as manual address entry when location is declined (5.1.1(iv)).

**[defect] Request the least access that does the job.** Apple asks for the
out-of-process picker or share sheet instead of full Photos or Contacts access
(5.1.1(iii)); Android lists lower-fidelity alternatives such as coarse instead
of precise location
(https://developer.android.com/privacy-and-security/minimize-permission-requests);
Play policy allows only permissions needed for current features promoted in
the listing (https://support.google.com/googleplay/android-developer/answer/9888170).
A new manifest permission or `Info.plist` usage key with no feature that needs
it is a finding.

## Offline and flaky networks

**[defect] The app works on an IPv6-only network.** App Review rejects apps
that do not (2.5.5). Hard-coded IPv4 literals or IPv4-only socket code are
the usual cause.

**[defect] A write the user expects to keep is not lost when the network is
down.** Android's offline-first guidance makes the local data source the
source of truth for any repository that uses the network, and drains queued
writes as persistent work with backoff
(https://developer.android.com/topic/architecture/data-layer/offline-first).
A save button whose only effect is a network call that fails while offline,
with no queue and no message, loses the user's input.

**[silence] The design states each feature's offline behaviour and its
conflict rule.** Lazy writes create conflicts when the device reconnects, and
the guidance requires a stated resolution
(https://developer.android.com/topic/architecture/data-layer/offline-first).
On iOS, `waitsForConnectivity` decides whether a URL session waits for a
connection or fails immediately
(https://developer.apple.com/documentation/foundation/urlsessionconfiguration/waitsforconnectivity).
Timeouts and retry budgets themselves are `resilience-patterns`.

**[trade-off] Online-only, queued or lazy writes.** The offline-first guide
names all three
(https://developer.android.com/topic/architecture/data-layer/offline-first):
online-only writes are simple and tell the user at once, queued writes suit
data where failure need not be reported (analytics), lazy writes keep critical
user data but need conflict resolution.

## Battery and background work

**[defect] Deferrable work that must survive app exit uses the platform
scheduler.** Android recommends WorkManager, which persists tasks across app
restarts and reboots
(https://developer.android.com/develop/background-work/background-tasks/persistent).
iOS schedules deferred work through `BGTaskScheduler`; the system picks the
time, and an app refresh task gets up to 30 seconds
(https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app).
A background loop, a repeating timer or a long-lived thread instead is a
finding.

**[defect] Background code does not assume exact timing or network access.**
Doze defers jobs, syncs, alarms and network access to maintenance windows
(https://developer.android.com/training/monitoring-device-state/doze-standby);
most apps can use inexact alarms
(https://developer.android.com/develop/background-work/services/alarms/schedule).
Background pushes sent more than three times per hour are rate-limited on iOS
(https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app).

**[defect] Each Android foreground service declares its type.** From Android
14 the manifest declares a service type and the app requests the matching
permission
(https://developer.android.com/develop/background-work/services/fgs/service-types).
iOS background modes may be used only for their intended purpose (App Review
2.5.4).

Excessive partial wake locks is one of Google Play's core vitals, and
exceeding its bad-behaviour threshold makes the app less discoverable
(https://support.google.com/googleplay/android-developer/answer/9844486).

## App size and startup time

**[defect] Nothing slow runs on the main thread before the first frame.**
Static initializers and main-thread work delay launch, and the iOS watchdog
terminates an app that takes too long to launch
(https://developer.apple.com/documentation/xcode/reducing-your-app-s-launch-time).
On Android, `Application.onCreate` runs before the first activity is drawn
(https://developer.android.com/topic/performance/vitals/launch-time). A new
SDK initialised synchronously at app start, or disk and network I/O there, is
a finding.

**[silence] A change that claims faster startup or smaller size gives a
release-build number.** Xcode Organizer and MetricKit measure time to first
frame (https://developer.apple.com/documentation/xcode/reducing-your-app-s-launch-time);
Android measures time to initial and full display, with `reportFullyDrawn`
for content loaded later
(https://developer.android.com/topic/performance/vitals/launch-time). Flutter
debug builds are not representative of size
(https://docs.flutter.dev/perf/app-size); Apple's accurate sizes come from an
app size report or App Store Connect
(https://developer.apple.com/documentation/xcode/reducing-your-app-s-size).

Store limits: Google Play caps the compressed download of an app bundle at
200 MB, with Play Feature Delivery and Asset Delivery for more
(https://developer.android.com/topic/performance/reduce-apk-size); Apple's
maximum uncompressed app size is 4 GB
(https://developer.apple.com/help/app-store-connect/reference/maximum-build-file-sizes).

**[trade-off] Baseline Profiles.** They speed up code execution by about 30%
from the first launch (https://developer.android.com/topic/performance/baselineprofiles/overview)
at the cost of a generation step and a Macrobenchmark setup to keep them
current.

## Secure storage and secrets in the binary

**[defect] No secret ships in the app.** Anything in the binary or its assets
can be recovered with reverse-engineering tools
(https://developer.android.com/privacy-and-security/risks/hardcoded-cryptographic-secrets).
React Native's `react-native-config` and `react-native-dotenv` values are not
secrets (https://reactnative.dev/docs/security); Flutter obfuscation only
renames symbols and does not protect resources
(https://docs.flutter.dev/deployment/obfuscate). A key that grants more than
the app's own user may do belongs behind a server.

**[defect] Credentials and tokens live in the Keychain or Android Keystore.**
MASVS-STORAGE-1 requires sensitive data to be stored securely
(https://mas.owasp.org/MASVS/controls/MASVS-STORAGE-1/) and MASVS-CRYPTO-2
covers keys stored outside the platform keystore
(https://mas.owasp.org/MASVS/controls/MASVS-CRYPTO-2/). Keystore key material
stays non-exportable (https://developer.android.com/privacy-and-security/keystore);
Async Storage is unencrypted (https://reactnative.dev/docs/security). A token
in `UserDefaults`, `SharedPreferences`, Async Storage or a plain file is a
finding.

**[defect] Sensitive data is excluded from backup and logs.** Android 12 and
later configure backup through `dataExtractionRules`
(https://developer.android.com/privacy-and-security/risks/backup-best-practices);
MASWE-0005 covers sensitive data in logs
(https://mas.owasp.org/MASWE/MASVS-STORAGE/MASWE-0005/).

**[defect] Transport exceptions are scoped and justified.** App Transport
Security requires HTTPS; Apple says to improve the server before adding an
exception, and an exception can be limited to particular servers instead of
the whole app (https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity).
Android cleartext traffic is covered in
https://developer.android.com/privacy-and-security/risks/cleartext-communications.

**[trade-off] Keychain items that migrate or stay on the device.** An
accessibility value ending in `ThisDeviceOnly` is not restored to another
device from a backup
(https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility):
device-only stops a token moving with a backup, and forces a new sign-in on a
new phone.

## Deep links and universal or app links

**[defect] Every link parameter is validated and no link performs a
destructive action directly.** Apple calls universal links an attack vector:
validate all parameters, discard malformed URLs, and do not let a link delete
content or expose sensitive data
(https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app).
Android lists host validation bypass, cross-app scripting and code execution
from unsafe deep links
(https://developer.android.com/privacy-and-security/risks/unsafe-use-of-deeplinks);
MASVS-PLATFORM-1 and MASVS-CODE-4 treat links as untrusted input
(https://mas.owasp.org/MASVS/controls/MASVS-PLATFORM-1/,
https://mas.owasp.org/MASVS/controls/MASVS-CODE-4/).

**[defect] Verified links are actually verified.** Android verifies hosts
when an intent filter has `android:autoVerify="true"` and the site serves
`/.well-known/assetlinks.json`
(https://developer.android.com/training/app-links/verify-android-applinks).
Apple requires the `apple-app-site-association` file over HTTPS with no
redirects, one per subdomain, fetched through an Apple-managed CDN
(https://developer.apple.com/documentation/xcode/supporting-associated-domains).
A new link host in the app with no matching association file change is a
finding. Flutter routing for links is `dart-named-routes`.

## WebView

**[defect] A JavaScript bridge is never reachable from untrusted content.**
`addJavascriptInterface` exposes the object to every frame, with no way to
check the caller's origin; remove the interface before loading untrusted
content and load it only over HTTPS
(https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges).
MASVS-PLATFORM-2 covers native functionality exposed in WebViews
(https://mas.owasp.org/MASVS/controls/MASVS-PLATFORM-2/).

**[defect] File access and URL loading are restricted.**
`setAllowFileAccess`, `setAllowFileAccessFromFileURLs` and
`setAllowUniversalAccessFromFileURLs` let malicious scripts read local files
(https://developer.android.com/privacy-and-security/risks/webview-unsafe-file-inclusion).
A URL from a link or server response must have both scheme and host
allowlisted before it reaches a WebView
(https://developer.android.com/privacy-and-security/risks/unsafe-uri-loading).
Lint routing is `kt-security-routing`. Apps that browse the web on iOS must
use WebKit (App Review 2.5.6).

## Store rules that block release

These stop an upload or a review, so a diff that adds an SDK, an API or a
data flow is checked against them before release, not after rejection.

**[defect] Required reason APIs and listed SDKs are declared in a privacy
manifest.** Since May 1, 2024 App Store Connect rejects apps that use a
required reason API without declaring the reason in `PrivacyInfo.xcprivacy`,
and each SDK must report its own use
(https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api,
https://developer.apple.com/documentation/bundleresources/privacy-manifest-files).
The categories are file timestamps, system boot time, disk space, active
keyboards and `UserDefaults`
(https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype).
SDKs on Apple's list need a privacy manifest and, as binaries, a signature
(https://developer.apple.com/support/third-party-SDK-requirements/).

**[defect] The build meets the current SDK and target floors.** Apple: since
April 28, 2026 uploads must be built with Xcode 26 and a 26 SDK, and since
September 9, 2026 iOS and iPadOS apps must target iOS 13 or later
(https://developer.apple.com/news/upcoming-requirements/). Google Play: since
August 31, 2026 new apps and updates must target API level 36 (Wear OS and
Automotive 35, TV and XR 34), with extensions available to November 1, 2026;
existing apps must target API level 35 to stay available to new users on
newer Android versions
(https://support.google.com/googleplay/android-developer/answer/11926878).
On 2026-10-19 the API 36 deadline has passed and the extension ends in 13
days.

**[defect] The Play data safety form changes with the data.** Every app on a production, open or closed track completes the
form, including data collected through SDKs
(https://support.google.com/googleplay/android-developer/answer/10787469).
A new SDK or data type with no note to update the form is a finding; what
counts as personal data is `privacy-review`.

**[defect] Account creation comes with in-app account deletion.** App Review
5.1.1(v); deactivation alone is not enough, and Sign in with Apple tokens are
revoked through its REST API
(https://developer.apple.com/support/offering-account-deletion-in-your-app/).

**[defect] No downloaded native code changes the app's features.** App
Review 2.5.2 forbids downloading code that changes features, with the 4.7
exceptions for mini apps and games; Google Play forbids downloading dex, JAR
or `.so` files and requires interpreted code loaded at run time to follow
policy (https://support.google.com/googleplay/android-developer/answer/9888379).

**[trade-off] Over-the-air JavaScript or Dart updates.** Shipping a bundle
outside the store fixes bugs without review delay, and stays within policy
only while it does not introduce or change features (App Review 2.5.2) or
violate Play policy
(https://support.google.com/googleplay/android-developer/answer/9888379); the
store version then no longer describes what users run.

## Forced update and old app versions

Users update on their own schedule. Apple's phased release reaches 1% of
automatic-update users on day 1 and 100% on day 7, can pause up to 30 days,
and anyone can still download the version manually
(https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases).
Play's staged rollout can be halted, which only stops more users receiving it
(https://support.google.com/googleplay/android-developer/answer/6346149).
Neither recalls a version already installed.

**[defect] A server change keeps every supported app version working.** A
field removed, a required field added or an enum value added breaks versions
still installed; the rules are `api-design`'s breaking-change items, and the
window lasts until the backend's minimum version rejects the old client.

**[defect] The app has a server-enforced minimum version.** MASVS-CODE-2
requires a mechanism to force updates
(https://mas.owasp.org/MASVS/controls/MASVS-CODE-2/); MASWE-0043 asks for the
backend to declare the minimum version and reject older clients, beside the
platform's update prompt
(https://mas.owasp.org/MASWE/MASVS-CODE/MASWE-0043/). Android's in-app
updates offer flexible and immediate flows
(https://developer.android.com/guide/playcore/in-app-updates).

**[silence] A risky feature names how it is turned off in versions already
shipped.** Since no store recalls an installed build, the design states the
remote switch or server-side guard; flag mechanics are `ops-readiness`.

**[trade-off] Blocking or flexible update.** MASWE-0043 reserves blocking
updates for security-critical releases so users accept them when it matters;
blocking more often protects the API from old clients and costs users who
cannot update at that moment.

## Crash and ANR reporting

**[defect] Release builds produce symbols that are kept for crash reports.**
Release builds put iOS debug symbols in a dSYM file
(https://developer.apple.com/documentation/xcode/building-your-app-to-include-debugging-information);
R8 stack traces need the `mapping.txt` of that build for `retrace`
(https://developer.android.com/topic/performance/app-optimization/troubleshoot-the-optimization);
an obfuscated Flutter build needs its `--split-debug-info` symbols for
`flutter symbolize` (https://docs.flutter.dev/deployment/obfuscate). A build
script change that drops or stops uploading them makes production crashes
unreadable. Flutter's error hooks are `dart-global-errors`.

**[defect] Nothing blocks the main thread long enough to cause an ANR or a
hang.** Android raises an ANR when input is not handled within 5 seconds,
`startForeground` is not called within 5 seconds, or a receiver runs too long
(https://developer.android.com/topic/performance/vitals/anr). Apple's tools
report a hang when the main run loop is unresponsive for more than 250 ms
(https://developer.apple.com/documentation/xcode/understanding-hangs-in-your-app).

**[silence] A release names the crash and ANR rates that stop the rollout.**
Google Play's bad-behaviour thresholds are 1.09% of daily users for crashes
and 0.47% for ANRs overall, and 8% on a single device model; above them the
app is less discoverable and may show a store warning
(https://support.google.com/googleplay/android-developer/answer/9844486).
MetricKit delivers daily metrics and immediate diagnostics on iOS 15 and
later (https://developer.apple.com/documentation/metrickit).

## Accessibility

Labels, tap targets and contrast per language are `swift-ui-a11y`,
`dart-semantics-label`, `dart-tap-target` and `dart-contrast`; design
judgment is `human-interface-guidelines`. The items below are the platform
settings no language standard checks.

**[defect] Text follows the user's text size setting.** Android text uses
`sp`, and `sp` is never used for layout sizes
(https://developer.android.com/training/multiscreen/screendensities). iOS text
uses text styles with automatic adjustment for Dynamic Type
(https://developer.apple.com/documentation/uikit/scaling-fonts-automatically),
and the HIG asks for text that enlarges to at least 200%
(https://developer.apple.com/design/human-interface-guidelines/accessibility).
React Native `Text` scales by default; `allowFontScaling={false}` on content
text, or a low `maxFontSizeMultiplier`, is a finding
(https://reactnative.dev/docs/text).

**[defect] Controls meet the platform's minimum target and are announced by
the screen reader.** Android recommends 48x48 dp
(https://developer.android.com/guide/topics/ui/accessibility/apps); the HIG
default for iOS is 44x44 pt
(https://developer.apple.com/design/human-interface-guidelines/accessibility).
React Native exposes `accessible` and `accessibilityLabel` for TalkBack and
VoiceOver (https://reactnative.dev/docs/accessibility).

## Push notifications

**[defect] Notification permission is requested, in context.** Android 13
and later need the `POST_NOTIFICATIONS` runtime permission
(https://developer.android.com/develop/ui/views/notifications/notification-permission);
Apple recommends asking when the user can see why, or provisional
authorization
(https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications).
App Review 4.5.4 forbids requiring push for the app to work and marketing
pushes without in-app opt-in.

**[defect] The device token is fetched on every launch and the server drops
dead ones.** Apple says never cache device tokens locally; APNs issues a new
one after a restore, on a new device or after an OS reinstall
(https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns).
FCM expires Android registrations inactive for 270 days and asks servers to
delete registrations that send requests report invalid
(https://firebase.google.com/docs/cloud-messaging/manage-tokens).

**[defect] Sensitive data is not sent in the notification payload.** App
Review 4.5.4.

**[trade-off] Background push or scheduled fetch for fresh content.**
Background pushes save polling but the system decides when to launch the app
and rate-limits them; `BGAppRefreshTask` needs no server but runs when the
system chooses
(https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app).

## Related

- `swift-patterns`, `kotlin-patterns`, `flutter-patterns`,
  `compose-multiplatform-patterns`, `android-clean-architecture` — language
  and framework items linked above.
- `human-interface-guidelines` — interaction and accessibility design.
- `privacy-review` — personal data, consent, analytics SDKs.
- `api-design`, `ops-readiness` — breaking changes, flags and rollback.
- `resilience-patterns` — timeouts, retries and backoff.

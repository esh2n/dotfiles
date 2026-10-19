---
name: i18n-review
description: Use when a change adds or edits user-visible text, formats or parses dates, times, numbers, currency or personal names, sorts or compares strings shown to users, measures, truncates or validates text input, handles keyboard input in a text field, lays out translated text, or touches locale, language or time-zone settings — and when diagnosing broken plurals, wrong-day dates, DST off-by-one-hour bugs, Turkish-i mismatches, emoji cut in half, mirrored-layout bugs, or a Japanese IME Enter that submits a form mid-conversion.
metadata:
  namespaces: [practice]
---

# i18n Review

Judgment criteria for text, time and numbers that people in other languages,
scripts and time zones will read or type — not a framework tutorial. The bug
class is "works in the author's locale": every item below passes a test run in
English, UTC and ASCII. Sources checked 2026-10-19.

Covered elsewhere, linked rather than repeated: `lang` on `<html>` and on
foreign-language passages is `semantic-html` (`html-lang`); timestamps, money
and language/region codes *on the wire* are `api-design` ("Time, money,
numbers, IDs"); physical vs logical CSS properties are `css-modern`; long
unbroken strings overflowing a box are `defensive-css`; locale formatting that
differs between server and client render is `react-patterns`
(`react-hydration-mismatch`); cron time zones are `ops-readiness`
(`ops:cron-timezone-dst`); Flutter ARB specifics are `flutter-patterns`.

## Messages and translation

**[defect] User-visible text lives in the message catalog, not in code.** A
string literal rendered to the user cannot be translated and is invisible to
the export the translators work from. Android: declare every string as a
resource, and keep the default `strings.xml` complete or an unsupported locale
can crash (https://developer.android.com/guide/topics/resources/localization);
Apple: wrap all user-facing text in localizable APIs so Xcode extracts it
(https://developer.apple.com/documentation/xcode/preparing-your-apps-text-for-translation).
Log lines, identifiers and machine-read output are not user-visible and must
*not* go through the catalog.

**[defect] Never build a sentence by concatenating fragments.** Word order,
agreement and case differ by language; a translator handed `"Delete " + name +
"?"` as two strings cannot reorder them, and a fragment reused in two sentences
cannot agree with both. One complete message per sentence with named or
numbered placeholders, or a topic-comment form ("Pages printed: 3") where the
invariant noun stays fixed
(https://www.w3.org/International/articles/composite-messages/). Pseudo-locales
expose this: a concatenated sentence shows up as several bracketed messages
(https://developer.android.com/guide/topics/resources/pseudolocales).

**[defect] Plurals go through CLDR plural categories, never `count == 1`.**
CLDR has six categories — `zero`, `one`, `two`, `few`, `many`, `other` — and
`other` is mandatory; `one` means "behaves like 1", which in some languages
includes 21 and 151 but not 11, and French puts 0 in `one`
(https://cldr.unicode.org/index/cldr-spec/plural-rules). Japanese, Chinese,
Korean and Thai have only `other`
(https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html),
so "1 件" and "3 件" are one message. Arabic uses all six. Use ICU
MessageFormat `plural`, Android `<plurals>` or the platform equivalent; Android
warns that plurals exist for grammar only and must not stand in for an `if`
on the value
(https://developer.android.com/guide/topics/resources/string-resource). In
English, a `zero` variant is ignored at count 0 — "no items" needs its own
branch in code, not a `zero` plural.

**[defect] Gender and other runtime choices use `select`, with full sentences
in each branch.** ICU recommends complex arguments as the outermost structure,
`select` outside `plural`, and whole sentences inside every sub-message rather
than minimal fragments; the legacy `choice` type is discouraged because it
cannot express plural rules
(https://unicode-org.github.io/icu/userguide/format_parse/messages/).
Inserting a person's name can force gendered changes elsewhere in the sentence
(W3C composite messages, above). MessageFormat 2 is still a draft
specification with an ICU4J technical preview (ICU page, above) — adopting it
is a choice, not a default.

**[defect] Lists, ranges, units and durations use the locale formatter.**
Joining with `", "` and `" and "` hard-codes English punctuation and
conjunctions; Apple ships list, interval, duration and measurement formatters
for exactly this
(https://developer.apple.com/documentation/xcode/preparing-dates-numbers-with-formatters);
the web equivalents are `Intl.ListFormat`, `Intl.DateTimeFormat.formatRange`,
`Intl.RelativeTimeFormat`.

**[defect] A new message carries context for the translator.** Say where it
appears and how much room it has; mark placeholders, names and code that must
not be translated (Android `<xliff:g>`), and give Apple strings a `comment:`
(Android localization and Apple text-for-translation pages, above). A bare
"Open" or "Post" has several translations depending on noun or verb, and
reused strings need annotations or message IDs so translators can match them
to their topic (W3C composite messages, above).

**[trade-off] Message IDs vs source-string keys.** Apple supports both the
source string as key and a separate key with a default value
(Apple text-for-translation page, above).

## Dates and times

**[defect] Formatting names its time zone.** `Intl.DateTimeFormat` without
`timeZone` uses the runtime default, so the same instant prints as a different
calendar day on another machine — MDN's own example shows 12/19 vs 12/20
(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat).
On a server the default is the host's zone, which is never the reader's.
Format with the viewer's IANA zone (`Asia/Tokyo`, never `Etc/` or legacy
`US/` IDs —
https://www.w3.org/TR/timezone/).

**[defect] Display through the locale's formatter, never a hand-built
pattern.** `MM/DD/YYYY` is read as day-first in most of the world; Apple's
guidance is to use the built-in formatters rather than accounting for the
variations yourself (Apple formatters page, above). A fixed pattern is right
only for machine-read output.

**[defect] Store instants in UTC; keep the zone for future events; keep
floating values floating.** W3C distinguishes incremental (instant) time,
floating time (a birthday, opening hours — no zone) and zoned time. Store and
exchange instants in UTC; for a past event an offset suffices, but a future
event needs the IANA zone ID, because DST rules can change before it happens
and a stored offset then points at the wrong wall time; never compare a
floating value with an instant without choosing a reference
(https://www.w3.org/TR/timezone/). The wire format is `api-design`'s.

**[defect] Calendar arithmetic goes through the zone, not fixed
milliseconds.** Adding 86,400,000 ms for "tomorrow" or computing each
recurrence as a fixed interval lands an hour off across a DST transition and
can produce local times that do not exist (W3C time zones, above). The
JavaScript `Date` object knows only UTC and the device zone, has no type for a
date without a zone, and mutates on every setter
(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal).

**[trade-off] `Temporal` vs `Date` plus `Intl`.** Temporal (`Instant`,
`ZonedDateTime`, `PlainDate`, `PlainTime`) separates the three kinds of time
and does DST-safe arithmetic. It is TC39 Stage 4 and shipped in Firefox 139,
Chrome 144 and Node 26, with no shipping status listed for Safari
(https://github.com/tc39/proposal-temporal); MDN marks it "Limited
availability", not Baseline (MDN Temporal page, above). Browser code that must
run in Safari today needs a polyfill or `Date` with explicit `timeZone` on
every format.

**[defect] Era calendars come from the platform, never a hard-coded table.**
`Intl.DateTimeFormat` with `calendar: "japanese"` (or `ja-JP-u-ca-japanese`)
and `era` renders 令和 dates from CLDR data (MDN DateTimeFormat page, above). A
hand-written era table breaks at the next era change: the name 令和 was
announced on 2019-04-01 for an era starting 2019-05-01, Windows shipped it as
an update to the era data its globalization APIs read, and the first year must
print as 元年 (gannen), not 1
(https://learn.microsoft.com/en-us/windows/apps/design/globalizing/japanese-era-change).

**[silence] For each date/time field, the design states whether it is an
instant, a zoned time or a floating value, and whose time zone the display
uses** — the user's profile, the device, or the event's location (W3C time
zones, above).

## Numbers and currency

**[defect] Numbers shown to users go through the locale formatter.**
`toFixed`, string replacement of separators or a hard-coded `$` assume one
locale: `de-DE` writes `123.456,79 €`
(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat).
Some languages also put the percent sign before the number (Apple formatters
page, above).

**[defect] Money is never a binary float.** Apple: do not use `Float` or
`Double` for currency, use `Decimal` (Apple formatters page, above). Keep
integer minor units or a decimal type end to end; `Intl.NumberFormat.format`
accepts a decimal string or `BigInt` and formats its exact value instead of a
rounded `Number`
(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/format).
The wire representation (ISO 4217 code with every amount) is `api-design`'s.

**[defect] Fraction digits come from the currency, not a constant 2.** With
`style: "currency"` the default maximum fraction digits is the currency's ISO
4217 minor unit — JPY formats `123456.789` as `￥123,457` (MDN NumberFormat
page, above). Code that always divides by 100 or always shows `.00` is wrong
for JPY and for three-digit currencies.

## Comparing and sorting text

**[defect] User-visible lists sort with a locale collator.** Default
`Array.prototype.sort` and `<` compare UTF-16 code units. `Intl.Collator`
compares per language — `ä` sorts with `a` in German and after `z` in Swedish
(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator).
Create one collator and reuse its `compare` for large arrays rather than
calling `localeCompare` per pair (same page). Code-unit order remains correct
for keys, IDs and anything machine-read.

**[defect] Case-insensitive matching uses full case folding plus
normalization, with an explicit locale only for linguistic text.** W3C:
Unicode simple case folding is not appropriate on the web, any case fold must
be followed by normalization, and Turkish dotted/dotless I is the standard
language-sensitive exception
(https://www.w3.org/TR/charmod-norm/, First Public Working Draft 2026-07-16).
`"İ".toLowerCase()` yields `i` plus U+0307 (two code points), while
`toLocaleLowerCase("tr")` yields `i`
(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toLocaleLowerCase).
The reverse failure is older and common: under a Turkish default locale,
lower-casing HTML tags, keywords or encoding names with the default locale
breaks them, which Java documented after regressions in SSL, Swing, XSLT and
XMLDecoder (https://bugs.openjdk.org/browse/JDK-6208680). Identifiers use a
locale-independent fold; user-facing search uses `Intl.Collator` with
`sensitivity: "base"` or `"accent"`.

**[silence] Sorting Japanese names needs the reading.** `Intl.Collator("ja")`
orders kanji by JIS X 0208 code position — CLDR's `ja` standard collation
(https://github.com/unicode-org/cldr/blob/main/common/collation/ja.xml) — so
高橋 sorts before 鈴木 although たかはし follows すずき (checked locally, Node
22). A design that sorts people in Japanese order states where the kana reading
comes from (see "Names and addresses").

## Unicode correctness

**[defect] Length limits, truncation, cursor steps and reversal count grapheme
clusters, not code units.** A user-perceived character can be several code
points — a base letter plus combining marks, a ZWJ emoji family, a flag pair
— and UAX #29's extended grapheme clusters approximate what the user sees
(https://www.unicode.org/reports/tr29/, Unicode 18.0.0). JavaScript `length`
counts UTF-16 code units: a three-person family emoji is 8 units and one
grapheme. Use `Intl.Segmenter` with `granularity: "grapheme"` (Baseline 2024,
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter).
Slicing by index can also leave a lone surrogate, which is invalid in UTF-8
and JSON: Claude Code's output truncator persisted `\ud83c` without its low
half, and every later `--resume` of that session failed with HTTP 400
(https://github.com/anthropics/claude-code/issues/45982). When storage size
matters too, enforce both: UAX #29 suggests pairing a grapheme limit with a
byte limit (UAX #29, above).

**[defect] Word splitting uses a segmenter, not spaces.** Japanese and Chinese
do not separate words with spaces; `split(" ")` returns the whole sentence,
while `Intl.Segmenter` with `granularity: "word"` splits it (MDN Segmenter
page, above).

**[defect] Text compared, deduplicated or used as a key is normalized first.**
`é` can be one code point or two; NFC makes them equal. NFKC also folds
compatibility characters — half-width and full-width katakana normalize to the
same string, and half-width ｶ + ﾞ becomes ガ — but it erases distinctions and
must not be applied blindly to free text; it fits restricted domains such as
identifiers (https://www.unicode.org/reports/tr15/, Unicode 18.0.0). W3C
discourages compatibility folding for most web matching (charmod-norm, above).

**[defect] Fields with a restricted repertoire accept full-width input.**
Japanese users routinely type `１２３-４５６７` in full-width digits from an IME.
Rejecting it as "not a number" is a defect; NFKC-normalize the restricted
field (digits, postal code, phone, email local part ASCII check) before
validating, which is the restricted-domain use UAX #15 allows. Do not
NFKC free text such as names or comments.

**[trade-off] Normalize at storage vs at comparison.** W3C recommends storing
UTF-8 and normalizing (NFC) when transcoding legacy text, and its matching
algorithm normalizes at comparison time (charmod-norm, above). Normalizing on
write keeps indexes consistent but changes what the user typed; normalizing on
compare keeps the original but every comparison path must remember to do it.

## Text direction

**[defect] Text whose direction is unknown is isolated.** A user name or
product title in Arabic or Hebrew inserted into an English sentence (or the
reverse) reorders the surrounding punctuation and numbers unless isolated.
UAX #9 added isolates (LRI, RLI, FSI, PDI) because embeddings were too strong
and hard to use, and says markup should replace explicit controls on the web
(https://www.unicode.org/reports/tr9/). In HTML use `<bdi>` or `dir="auto"`;
in plain-text contexts (titles, attributes, CSV, WebVTT) wrap with FSI … PDI,
the control equivalent of `dir="auto"`
(https://www.w3.org/International/questions/qa-bidi-unicode-controls).

**[defect] Layout uses logical directions in any UI that ships an RTL
locale.** `margin-inline-start`, `padding-inline-end`, `text-align: start`
follow the writing direction; `left`/`right` do not
(https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values).
Details and the exceptions are `css-modern`. Apple and Android equivalents are
leading/trailing constraints and `start`/`end` attributes; both platforms ship
an RTL pseudo-locale to test this (see "Translation workflow").

## Layout under translation

**[defect] Containers for translated text do not assume English length.**
Short strings expand most: IBM's averages are 200–300% for strings up to 10
characters and about 130% above 70; Flickr's "views" is 2.8× longer in German
and 3× in Italian; Thai text needs about 150% of the vertical space of English
(https://www.w3.org/International/articles/article-text-size). Fixed widths
or heights on buttons, tabs and badges clip; overflow handling is
`defensive-css`.

**[defect] CJK line breaking relies on `lang`, not inserted breaks.** Browsers
pick line-breaking, hyphenation and Han glyph shapes by the declared language
(https://www.w3.org/International/questions/qa-lang-why). `line-break`
(Baseline widely available since 2020) controls how strictly the
start-of-line and end-of-line prohibitions for punctuation and small kana
apply (https://developer.mozilla.org/en-US/docs/Web/CSS/line-break);
`word-break: keep-all` stops breaks between CJK characters, and `auto-phrase`
is still experimental
(https://developer.mozilla.org/en-US/docs/Web/CSS/word-break). Flag
`word-break: break-all` applied to a whole page, and manual `<br>` in
translated headings.

**[defect] CJK text gets a language and a font stack that covers it.**
Chinese, Japanese and Korean share code points for ideographs but readers
expect different glyph details, and some browsers choose the font by `lang`
(W3C "Why use the language attribute?", above). A Latin web font with no
CJK glyphs and a missing or wrong `lang` makes Japanese render in whatever
fallback the system picks, often Chinese glyph forms. Declare `lang` (see
`semantic-html`) and end the font stack with fonts that cover the scripts the
product ships.

## Input methods

**[defect] Enter during IME composition never submits.** Japanese, Chinese and
Korean input methods use Enter to confirm a conversion. A `keydown` handler
that submits on Enter must skip events where `event.isComposing` is true *or*
`event.keyCode === 229`: `compositionend` can fire before the `keydown` of the
confirming key, leaving `isComposing` false while `keyCode` is still 229, so
MDN advises checking both even though `keyCode` is deprecated
(https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event).
Safari's event order made `isComposing`-only checks fail for years — WebKit
bug 165004, filed 2016, closed 2026 as fixed by another bug
(https://bugs.webkit.org/show_bug.cgi?id=165004) — so older Safari versions
in the support matrix still need the 229 check. The failure is current: in
Claude Code's VS Code extension, the Enter that confirms a Japanese conversion
submits the inline plan comment (https://github.com/anthropics/claude-code/issues/85915).
The same rule applies to
ArrowUp/Down history recall, autocomplete selection and any shortcut bound to
a key the IME uses.

**[defect] Per-keystroke logic waits for composition to end.** Validation,
character counters, search-as-you-type and input masks run on uncommitted
composition text otherwise; act on `compositionend`, or skip `input` events
whose `isComposing` is true
(https://developer.mozilla.org/en-US/docs/Web/API/InputEvent/isComposing —
MDN marks the property "Limited availability", so keep the `compositionend`
path as the reliable one).

## Names and addresses

**[defect] Name fields do not assume a first/last structure.** Family name
comes first in Japanese, Korean, Chinese and Hungarian; many Spanish speakers
have two family names; some people have no family name at all. Do not require
a family name, avoid "first name"/"last name" labels (use "given name" and
"family name" when splitting), allow long names, spaces, hyphens and
apostrophes, and never force upper case or reject a single letter
(https://www.w3.org/International/questions/qa-personal-names). Greeting
"Dear {firstName}" breaks with every one of these.

**[trade-off] One full-name field vs split fields.** W3C suggests considering
a single field first, plus a separate "what should we call you" field (W3C
personal names, above). Split fields support sorting and formal address but
mislabel many names.

**[trade-off] Phonetic (furigana) field for Japanese names.** Kanji names have
several readings, so W3C suggests considering a kana field (W3C personal
names, above); it is also what Japanese sorting needs. Make it optional, or
required only where the reading is actually used: requiring kana from users
without a Japanese name blocks them.

**[defect] Address forms follow the country, not one template.** Required
fields and order differ: Google's address metadata requires a postal code for
Japan and puts it first, defines no postal code for Hong Kong and does not
require one for Ireland
(https://chromium-i18n.appspot.com/ssl-address/data/JP, `/HK`, `/IE`).
`libaddressinput` uses that data to build per-country forms
(https://github.com/google/libaddressinput). Flag a postal code or state
required for every country, and a US-only ZIP regex.

## Translation workflow and testing

**[defect] Localization is tested with pseudo-locales, not only English.**
Android's `en-XA` adds accents, expands text and brackets each message, which
exposes hard-coded strings (unaccented), concatenation (several brackets) and
clipping; `ar-XB` forces RTL
(https://developer.android.com/guide/topics/resources/pseudolocales). Xcode
offers double-length, right-to-left, accented, bounded-string, emoji and tall
pseudolanguages and a "show non-localized strings" switch
(https://developer.apple.com/documentation/xcode/preparing-your-interface-for-localization).
On the web, run tests with at least a non-English locale, a non-UTC time zone
(`TZ=Asia/Tokyo` or a zone with DST) and inputs containing combining marks,
emoji and RTL text. A test suite that only runs in `en-US`/UTC passes every
defect above.

**[silence] The design names the supported locales and the fallback.** Which
locales ship, which locale the default resources are in, and what happens for
an unsupported one (Android: the default file must contain every string or the
app can crash — Android localization page, above).

**[silence] The design states the unit of every text limit** — graphemes for
what the user sees, bytes for storage, or both (UAX #29, above).

## Related

- `semantic-html` — `lang` and its parts (`html-lang`).
- `api-design` — time, money and language codes on the wire.
- `css-modern` — logical properties; `defensive-css` — overflow of long text.
- `react-patterns` — locale formatting and hydration mismatch.
- `ops-readiness` — scheduled jobs and DST.
- `flutter-patterns`, `java-coding-standards`, `csharp-patterns` — language
  rules for locale-dependent formatting and case conversion.
- `human-interface-guidelines` — cultural meaning of icons and symbols.

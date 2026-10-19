# i18n-review — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` and `ui-reviewer` through the `change-review` skill when a diff adds user-visible text, formats dates, times, numbers, currency or names, sorts or compares strings shown to users, handles text input, or touches locale or time-zone settings (defects in a diff; `ui-reviewer` takes the layout, direction, font and expansion items from the screenshots), by `spec-reviewer` (silences in a design or spec review), and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md. Items owned by another skill (`lang`, wire formats, logical CSS properties, overflow) are reviewed from that skill's checklist, not here.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: i18n:hardcoded-string
  rule: User-visible text lives in the message catalog, not in code.
  check: A string literal rendered to the user (JSX text, template text, `Text("...")`, alert/toast/error message shown in UI, email subject) in a project that has a catalog or ships more than one locale; a key added in code but missing from the default resource file. Do not flag log lines, identifiers or machine-read output.
  section: "## Messages and translation"

- id: i18n:concatenated-message
  rule: Never build a sentence by concatenating fragments.
  check: `+`, template literals, `join` or adjacent `t()` calls assembling one sentence from translated pieces or from a translated piece plus a variable; one translated fragment reused inside several sentences.
  section: "## Messages and translation"

- id: i18n:plural-by-condition
  rule: Plurals go through CLDR plural categories, never `count == 1`.
  check: `count === 1 ? "item" : "items"`, `"(s)"` suffixes, appending `s`; a plural message with no `other` branch; a `zero` plural used to produce "no items" in English.
  section: "## Messages and translation"

- id: i18n:select-by-fragment
  rule: Gender and other runtime choices use `select`, with full sentences in each branch.
  check: A pronoun, gendered word or variant picked in code and spliced into a message; a `select` or `plural` whose branches hold fragments instead of whole sentences; `plural` wrapping `select`; use of the ICU `choice` type.
  section: "## Messages and translation"

- id: i18n:list-or-unit-by-hand
  rule: Lists, ranges, units and durations use the locale formatter.
  check: `items.join(", ")` with `" and "` / `" or "` for display; hand-built "3 min ago", "2–5 May", "5 km" strings instead of `Intl.ListFormat`, `formatRange`, `Intl.RelativeTimeFormat` or the platform formatter.
  section: "## Messages and translation"

- id: i18n:translator-context-missing
  rule: A new message carries context for the translator.
  check: A new short or ambiguous message (single word, noun/verb homograph, contains placeholders) added with no description/comment; placeholders, names, URLs or code not marked non-translatable where the format supports it (`<xliff:g>`, ICU argument, Apple `comment:`).
  section: "## Messages and translation"

- id: i18n:format-without-timezone
  rule: Formatting names its time zone.
  check: `toLocaleString`, `toLocaleDateString`, `Intl.DateTimeFormat`, `strftime` or a platform formatter called without an explicit time zone in server-side or shared code; a legacy (`US/Eastern`) or `Etc/` zone ID, or a fixed offset used as a user's zone.
  section: "## Dates and times"

- id: i18n:date-fixed-pattern
  rule: Display through the locale's formatter, never a hand-built pattern.
  check: `MM/DD/YYYY`, `YYYY年M月D日`, `getMonth()+1` string assembly or a fixed format string used for text shown to users.
  section: "## Dates and times"

- id: i18n:time-stored-wrong-kind
  rule: Store instants in UTC; keep the zone for future events; keep floating values floating.
  check: A local wall time stored with no offset or zone for an instant; a future event (meeting, reminder, recurrence) stored as an offset only, with no IANA zone ID; a birthday or opening hour stored as a UTC instant; a floating value compared with an instant without a stated reference.
  section: "## Dates and times"

- id: i18n:dst-fixed-arithmetic
  rule: Calendar arithmetic goes through the zone, not fixed milliseconds.
  check: `+ 86400000`, `+ 24 * 60 * 60`, `setHours(h + 24)` or a fixed interval used for "tomorrow", "next week" or each occurrence of a recurring local-time event.
  section: "## Dates and times"

- id: i18n:era-hardcoded
  rule: Era calendars come from the platform, never a hard-coded table.
  check: An in-code table of Japanese era names or start dates; year-of-era computed by subtracting a constant; no handling of 元年 for the first year of an era.
  section: "## Dates and times"

- id: i18n:number-by-hand
  rule: Numbers shown to users go through the locale formatter.
  check: `toFixed`, regex insertion of `,` thousands separators, replacing `.` with `,`, or a literal currency symbol concatenated to a number for display.
  section: "## Numbers and currency"

- id: i18n:float-money
  rule: Money is never a binary float.
  check: Prices or totals held, summed or rounded as `number`/`float`/`double`; `parseFloat` on an amount; formatting a computed float total instead of a decimal string, `BigInt` or minor-unit integer.
  section: "## Numbers and currency"

- id: i18n:currency-digits-assumed
  rule: Fraction digits come from the currency, not a constant 2.
  check: Dividing or multiplying amounts by 100 regardless of currency; `minimumFractionDigits: 2` / `.00` forced for every currency.
  section: "## Numbers and currency"

- id: i18n:code-unit-sort
  rule: User-visible lists sort with a locale collator.
  check: `sort()` with no comparator, `a < b`, or `localeCompare` called per pair in a hot sort over a large array, on strings shown to users.
  section: "## Comparing and sorting text"

- id: i18n:case-fold-wrong-locale
  rule: Case-insensitive matching uses full case folding plus normalization, with an explicit locale only for linguistic text.
  check: `toLowerCase()`/`toUpperCase()` equality on user-entered text with no normalization; default-locale case conversion on identifiers, keywords, tags, header names or encodings (Java `toLowerCase()` without `Locale.ROOT`, .NET `ToLower()` without invariant culture).
  section: "## Comparing and sorting text"

- id: i18n:code-unit-length
  rule: Length limits, truncation, cursor steps and reversal count grapheme clusters, not code units.
  check: `length`, `substring`, `slice`, `split("")`, `[...s].reverse()` or byte-index truncation used for a user-visible limit, ellipsis or counter; truncation that can cut between surrogate halves; a byte-limited column validated only by a character count.
  section: "## Unicode correctness"

- id: i18n:split-on-spaces
  rule: Word splitting uses a segmenter, not spaces.
  check: `split(" ")` or `\s+` used to count, highlight or wrap words in text that may be Japanese, Chinese or Thai.
  section: "## Unicode correctness"

- id: i18n:unnormalized-compare
  rule: Text compared, deduplicated or used as a key is normalized first.
  check: User-entered strings used as unique keys, usernames, tags or search terms with no `normalize("NFC")` (or equivalent) on either write or compare; NFKC applied to free text such as names or comments.
  section: "## Unicode correctness"

- id: i18n:fullwidth-rejected
  rule: Fields with a restricted repertoire accept full-width input.
  check: A digits, postal-code, phone or similar field whose validator rejects full-width characters (`１２３`) instead of NFKC-normalizing the field before validation.
  section: "## Unicode correctness"

- id: i18n:bidi-not-isolated
  rule: Text whose direction is unknown is isolated.
  check: User- or data-supplied text (names, titles, file names) interpolated into a sentence or label without `<bdi>`, `dir="auto"` or FSI…PDI in a product that ships or accepts RTL text; embedding controls (LRE/RLE) used instead of isolates.
  section: "## Text direction"

- id: i18n:physical-direction
  rule: Layout uses logical directions in any UI that ships an RTL locale.
  check: New `left`/`right` margins, padding, positioning or `text-align` in a UI with an RTL locale; native layouts using left/right instead of leading/trailing or start/end. Defer the CSS details to `css-modern`.
  section: "## Text direction"

- id: i18n:fixed-size-text-container
  rule: Containers for translated text do not assume English length.
  check: Fixed `width`/`height` or a character-count cap on buttons, tabs, badges or menu items that hold translated text; screenshots in a pseudo-locale or a long locale show clipping.
  section: "## Layout under translation"

- id: i18n:cjk-break-forced
  rule: CJK line breaking relies on `lang`, not inserted breaks.
  check: `word-break: break-all` set globally; manual `<br>` or zero-width spaces inserted into translated headings; `auto-phrase` relied on without fallback.
  section: "## Layout under translation"

- id: i18n:cjk-font-fallback
  rule: CJK text gets a language and a font stack that covers it.
  check: A web font stack with no font covering Japanese/Chinese/Korean in a product shipping those locales, combined with missing or wrong `lang`; screenshots show Chinese glyph forms in Japanese text.
  section: "## Layout under translation"

- id: i18n:ime-enter-submits
  rule: Enter during IME composition never submits.
  check: A `keydown`/`keypress` handler that submits, sends, selects or recalls history on Enter or arrow keys without returning early when `event.isComposing` is true or `event.keyCode === 229`; a check on `isComposing` alone.
  section: "## Input methods"

- id: i18n:per-keystroke-during-composition
  rule: Per-keystroke logic waits for composition to end.
  check: Validation, counters, input masks or search requests fired from `input`/`keydown` with no `compositionend` handling or composing check.
  section: "## Input methods"

- id: i18n:name-structure-assumed
  rule: Name fields do not assume a first/last structure.
  check: A required family/last-name field; "First name"/"Last name" labels; a short max length; a pattern rejecting spaces, hyphens, apostrophes or non-Latin letters; forced upper case; "Dear {firstName}" built from a split name.
  section: "## Names and addresses"

- id: i18n:address-single-template
  rule: Address forms follow the country, not one template.
  check: Postal code or state/province required for every country; a US ZIP regex or fixed field order applied to all countries.
  section: "## Names and addresses"

- id: i18n:english-only-tests
  rule: Localization is tested with pseudo-locales, not only English.
  check: A change in this checklist's scope whose tests run only in `en-US` and UTC with ASCII input — no non-English locale, no non-UTC or DST zone, no combining-mark, emoji or RTL input, no pseudo-locale run.
  section: "## Translation workflow and testing"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: i18n:time-kind-unstated
  rule: For each date/time field, the design states whether it is an instant, a zoned time or a floating value, and whose time zone the display uses.
  check: List every date/time field the design introduces; flag each with no stated kind, and each displayed time with no stated zone source (user profile, device, event location).
  section: "## Dates and times"

- id: i18n:japanese-sort-reading-unstated
  rule: Sorting Japanese names needs the reading.
  check: A design that sorts people, places or titles for Japanese users and does not say where the kana reading comes from.
  section: "## Comparing and sorting text"

- id: i18n:locales-and-fallback-unstated
  rule: The design names the supported locales and the fallback.
  check: No list of shipped locales, no default-resource locale, or no behaviour for an unsupported locale.
  section: "## Translation workflow and testing"

- id: i18n:text-limit-unit-unstated
  rule: The design states the unit of every text limit.
  check: A length limit given as a bare number with no unit (graphemes, code points, bytes), or a storage limit with no matching user-visible limit.
  section: "## Translation workflow and testing"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: i18n:message-id-or-source-key
  rule: Message IDs vs source-string keys.
  options: source string as key (no naming step, easy to read in code; editing the English text changes the key and drops translations) | stable message ID with default value (survives copy edits, one string can mean different things in two places; needs an ID convention and the source text lives elsewhere)
  section: "## Messages and translation"

- id: i18n:temporal-or-date
  rule: `Temporal` vs `Date` plus `Intl`.
  options: Temporal natively (separate instant/zoned/floating types, DST-safe arithmetic; no Safari shipping status, not Baseline) | Temporal with a polyfill (same model everywhere; adds bundle weight and a dependency) | `Date` with explicit `timeZone` on every format (no dependency; one mutable type for every kind of time, arithmetic must be done through the zone by hand)
  section: "## Dates and times"

- id: i18n:normalize-on-write-or-compare
  rule: Normalize at storage vs at comparison.
  options: NFC on write (indexes and uniqueness consistent; stored text differs from what was typed) | normalize at compare (original preserved; every comparison path must remember it) | both (consistent and safe; normalization cost on both sides)
  section: "## Unicode correctness"

- id: i18n:full-name-or-split
  rule: One full-name field vs split fields.
  options: single full-name field plus "what should we call you" (fits every name structure; no family-name sort or formal address without asking) | given and family fields (sorting and formal address; mislabels names without a family name or with several) | both (covers each need; longer form)
  section: "## Names and addresses"

- id: i18n:furigana-required-or-optional
  rule: Phonetic (furigana) field for Japanese names.
  options: required (reliable Japanese sort order and reading; blocks users without a Japanese name) | optional (no one blocked; sort falls back to JIS code order for missing readings) | required only when the UI locale is Japanese or the name contains kanji (targets the need; more form logic)
  section: "## Names and addresses"

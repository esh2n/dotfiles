---
name: privacy-review
description: Use when a change collects, stores, logs, shares, exports or deletes personal data — a new field, form, table, cache or search index holding data about people, a log line, span attribute, metrics label, error report or analytics event that may carry it, a third-party SDK or subprocessor, an LLM call that receives user content, a consent flow, an account-deletion or data-export path, a retention or TTL change, seed data or test fixtures — and when deciding whether hashing makes data anonymous, whether a deletion reaches every copy, or what a design must state about personal data before it is built.
metadata:
  namespaces: [practice]
---

# Privacy Review

Engineering checks for changes that touch personal data. This skill does not
decide whether a law applies, which legal basis is right, or whether a transfer
is lawful; those are questions for the owner, asked with the facts the review
found. The two primary frameworks are the EU GDPR and Japan's Act on the
Protection of Personal Information (APPI, 個人情報保護法); California's
CCPA/CPRA appears only where it changes what the code must do. Sources were
opened on 2026-10-19. GDPR articles are cited from the gdpr-info.eu reprint;
the official EUR-Lex text
(https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng) did not load in this run
and is unverified here. APPI is cited from the e-Gov text in force from
2026-10-01 (https://laws.e-gov.go.jp/law/415AC0000000057).

A privacy finding names four things: the data, the person it belongs to, the
sink it reaches, and the harm (exposure, retention beyond purpose, a recipient
or region nobody approved, no way to erase). `security-reviewer`'s Privacy
section traces data from source to sink; this file holds the criteria it
applies at each sink.

## Classify every field

**[silence] Each new field states its class and its purpose.** Three classes
change what a review checks:

| Class | GDPR | APPI | What changes |
|---|---|---|---|
| Personal | Any information about an identified or identifiable person, including online identifiers (Art. 4(1), https://gdpr-info.eu/art-4-gdpr/) | 個人情報 and 個人識別符号, Art. 2(1)–(2) | Every check below applies |
| Special category / sensitive | Racial or ethnic origin, political opinions, religious or philosophical beliefs, trade-union membership, genetic data, biometric data used to identify, health, sex life or sexual orientation (Art. 9(1), https://gdpr-info.eu/art-9-gdpr/) | 要配慮個人情報 (race, creed, social status, medical history, criminal record, having been a victim of crime, and others set by cabinet order), Art. 2(3); acquiring it needs prior consent outside listed exceptions, Art. 20(2) | Collection itself needs a basis the owner confirms; logs and analytics must never carry it |
| Credentials | Not a GDPR category, but passwords and tokens are personal data with the highest exposure impact | — | Hashing and storage go to `security-reviewer` |

**[defect] Online identifiers are personal data.** An account id, IP address,
device id, advertising id or cookie id identifies a person by combination, so
code that labels them "anonymous" and sends them to analytics or a vendor
without the checks below is a finding (GDPR Art. 4(1)). Under APPI, data that
identifies no one in the sender's hands (個人関連情報, Art. 2(7)) still needs a
consent check before it goes to a third party expected to link it to a person
(Art. 31).

Inference counts: Norway's regulator held that the fact that someone is a
Grindr user is data about their sexual orientation, and fined Grindr NOK 65
million in 2021 for sharing that status with ad partners without valid
consent, under Art. 6(1) and 9(1)
(https://techcrunch.com/2021/12/15/grindr-final-gdpr-fine/).

## Data minimisation and purpose limitation

**[defect] Collect only what the feature reads.** A field written by the
change and never read by the feature it was added for is collection beyond
need (GDPR Art. 5(1)(c), https://gdpr-info.eu/art-5-gdpr/). Collecting
because the data may be useful later is not a purpose; the ICO says so
directly
(https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/).
APPI requires the purpose of use to be specified as far as possible and
forbids handling beyond it without consent (Art. 17–18).

**[defect] A new reader is a new purpose.** When the change reads existing
personal data for something other than what it was collected for — support
email reused for marketing, production records fed into model training,
location kept for fraud reused for ads — the finding names the old and the
new purpose. Whether the new purpose is compatible (GDPR Art. 6(4),
https://gdpr-info.eu/art-6-gdpr/; APPI Art. 17(2)) is a question for the
owner, never a reviewer's conclusion.

**[defect] Defaults are the narrowest setting.** Optional collection starts
off, visibility starts private, and nothing becomes visible to an unlimited
audience without the person acting (GDPR Art. 25(2) covers amount collected,
extent of processing, storage period and accessibility,
https://gdpr-info.eu/art-25-gdpr/). Ireland's DPC fined TikTok EUR 345 million
in 2023 after examining public-by-default settings for child accounts, citing
Art. 5(1)(c) and 25(1)–(2) among others
(https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-345-million-euro-fine-of-TikTok).

California's regulations add the same test in their own words: collection,
use, retention and sharing must be reasonably necessary and proportionate,
judged from the minimum data the purpose needs (CCPA Regulations § 7002(d),
https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf). It changes
nothing in the check above.

## Personal data in logs, traces, metrics, error reports and analytics

Telemetry is the most common unplanned copy: it is written on every request,
shipped to vendors, kept on its own schedule and rarely reached by deletion.

**[defect] Telemetry does not carry personal data or credentials by
default.** OWASP's Logging Cheat Sheet lists what to keep out of logs or
remove, mask, sanitise, hash or encrypt first: session ids, access tokens,
passwords, keys and connection strings, sensitive personal data such as health
or government ids, payment data, data above the log store's classification,
and data the person did not consent to
(https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
Names, emails and phone numbers need de-identification when the identity is
not needed for the investigation. The same applies to span attributes, error
report context and analytics event properties.

**[defect] Log by allow-list, not by object dump.** Logging a whole user,
request, header map or body (`%+v`, `JSON.stringify(req)`,
`logger.info(user)`) sends every field the object gains later. URL query
strings, `Authorization` and `Cookie` headers and free text users typed are
the usual carriers. OpenTelemetry's redaction processor works the same way:
it deletes every attribute not on an allowed list
(https://opentelemetry.io/docs/security/handling-sensitive-data/).

**[defect] Redact before the data leaves your environment.** Scrubbing in the
vendor's UI stops storage but the data has already been sent; Sentry's
documentation recommends removing it in the SDK (`before_send` and the related
hooks) so it never leaves
(https://docs.sentry.io/platforms/python/data-management/sensitive-data/).
Vendor-side rules are a second layer, not the control. An SDK option that
turns on default PII collection (Sentry's `send_default_pii`) is a finding when
the change enables it without a stated need.

**[trade-off] Where redaction runs.** Redacting at the call site or in an SDK
hook keeps data in the process but depends on every author; a collector you
run (OpenTelemetry's processors) centralises the allow-list, but the data
crosses your own network first.

**[defect] Metrics labels never hold a person's identifier.** A user id or
email as a label value is both a privacy copy and a cardinality problem; the
label check is in `observability-patterns`.

**[silence] Telemetry retention is stated and does not outlive the source
data's purpose.** OWASP says logs must be kept neither shorter nor longer than
the required period. A log that keeps a user's email for a year after the
account was erased defeats the erasure.

Negative evidence: in January 2025 Wiz found DeepSeek's ClickHouse database
open to the internet without authentication, holding over a million log lines
with plaintext chat history and API keys
(https://www.wiz.io/blog/wiz-research-uncovers-exposed-deepseek-database-leak).
The logs held what the product's users typed, so the logs became the breach.

## Pseudonymisation is not anonymisation

**[defect] Pseudonymised data is still personal data.** Replacing an
identifier with a token, hash or key-coded value leaves data that can be
attributed to a person with additional information, so storage limitation,
erasure and access rights still apply (GDPR Art. 4(5) and Recital 26,
https://gdpr-info.eu/recitals/no-26/). EDPB Guidelines 01/2025 add that this
holds even when the additional information sits with another party, and that
erasing the key does not by itself make the data anonymous
(https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf;
adopted for public consultation, final text not checked). A change that
excludes a "hashed" or "anonymised" table from deletion, export or retention
jobs on that ground is a finding.

**[defect] An unkeyed hash of an email, phone number or user id is
reversible.** Anyone who holds candidate values hashes them and matches; EDPB
01/2025 uses a SHA-256 hash of a name as its example of this attack and asks
for a secret with enough entropy in the transformation (keyed one-way
functions such as HMAC, or random pseudonyms in a secret lookup table), with
the secret protected apart from the data. OpenTelemetry warns the same for
small, predictable input spaces such as numeric ids. Truncating or
generalising (year only, email domain only, IPv4 last octet dropped) removes
information instead of hiding it.

**[trade-off] Which replacement to use.** A keyed function keeps records
joinable across datasets but makes the key a secret to protect and rotate; a
random token in a lookup table leaves no key to brute-force but makes the
table a sensitive store; truncation or aggregation needs no secret but loses
joins and per-person analysis. The choice follows what the downstream use
needs.

Negative evidence: Denmark's regulator found that Taxa 4x35 deleted customer
names after two years but kept phone numbers, which still tied trips to
people, and set a DKK 1.2 million fine (2019); removing the name was not
anonymisation
(https://gdpr.eu/data-anonymization-taxa-4x35/).

APPI has two statutory forms with their own duties. 仮名加工情報
(pseudonymously processed information, Art. 2(5)) may not be given to third
parties, matched to re-identify, or used to phone, mail or email the person,
and the removed identifiers must be protected (Art. 41). 匿名加工情報
(anonymously processed information, Art. 2(6)) must be impossible to restore.
**[silence] A design that labels a dataset with either term states which one
and why;** whether it meets the statutory processing standard is a question
for the owner.

## Retention and deletion

**[defect] Every new store of personal data has an enforced retention.** A
table, bucket, cache, queue, search index or analytics dataset without a TTL,
partition expiry or scheduled delete keeps data forever (GDPR Art. 5(1)(e)).
EDPB Guidelines 4/2019 expect deletion to be automated and tested, and the
retention period justified per purpose
(https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_201904_dataprotection_by_design_and_by_default_v2.0_en.pdf).
APPI makes prompt deletion of data no longer needed a duty to strive for
(Art. 22). A soft-delete flag with no purge job is no retention at all.

Negative evidence: Berlin's regulator fined Deutsche Wohnen EUR 14.5 million in
2019 because its tenant archive could not delete data that was no longer
needed, citing Art. 5 and 25(1)
(https://www.insideprivacy.com/eu-data-protection/real-estate-company-fined-e-14-5-million-in-germany-for-violating-gdpr-principle-of-privacy-by-design/;
the fine was later contested in court, outcome not checked here).

**[defect] Deletion reaches every copy.** Trace each store the data flows into
and confirm the delete or expiry reaches it: caches, search indexes, read
models and projections, data-warehouse and analytics copies, exports, vector
embeddings, prompt and completion logs, and data held by vendors. EDPB 4/2019
names backups, logs and "temporary" copies as stores whose retention must be
decided.

**[silence] Backups have a stated retention, and a restore does not bring
erased data back.** The ICO treats data deleted from live systems as needing
deletion from backups too, and says moving data offline is not deletion
(https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/).

**[trade-off] How erasure reaches every copy, backups included.** Hard
deletion everywhere is the clearest result but must reach each copy in the
trace. Anonymising in place keeps aggregates but must truly prevent
re-identification (removing the name alone did not, above). For backups, a
short expiry cycle limits the recovery window; replaying a deletion log after
any restore keeps longer backups but the log must itself be minimal.
Per-person encryption keys destroyed on erasure ("crypto-shredding") reach
backups without rewriting them but add key management; this last option is a
practitioner pattern not checked against a source in this file.

**[defect] Deletion cannot be undone.** Japan's PPC guideline asks for
deletion by a method that prevents recovery, and a record that it happened
(通則編 10-5, https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/).

## LLM calls that receive user content

**[defect] The prompt carries only the personal data the task needs.**
Sending a whole user record, another user's data, or a conversation history
longer than the task needs is collection by a new recipient. Japan's PPC told
businesses in 2023 to confirm that personal data entered into a generative AI
service stays within the specified purpose, and warned that the business may
breach APPI if the provider handles that data for anything beyond producing
the response — training, for example — so the provider's no-training terms
must be confirmed
(https://www.ppc.go.jp/files/pdf/230602_alert_generative_AI_service.pdf).

**[defect] Prompt and completion logs are personal-data stores.** They need
the telemetry checks above and a place in the retention and deletion trace.
OWASP's LLM02:2025 lists sanitising input, user opt-out from training, and
retention and deletion policies among the mitigations
(https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/).

**[silence] The design names the model vendor, whether inputs are used for
training, the vendor's retention period and its processing region.** These
come from the vendor's current terms and the account's settings, not from
code.

Negative evidence: Italy's Garante fined OpenAI EUR 15 million in December 2024
for training on personal data without an adequate legal basis, transparency
failures and the lack of age verification for under-13s
(https://www.euronews.com/2024/12/20/italys-privacy-watchdog-fines-openai-15-million-after-probe-into-chatgpt-data-collection).

## Third-party SDKs and subprocessors

**[defect] An SDK that collects on its own starts only after the basis for it
exists.** Analytics, advertising, attribution and session-replay SDKs read
device ids, IPs and in-app behaviour at initialisation. When consent is the
basis, initialising at app start, before the consent screen, is a finding;
when the SDK has a PII switch, it stays off unless the design states the need.

**[silence] A new subprocessor is named with what it receives, why, and
where.** GDPR requires processors with sufficient guarantees, a contract, the
controller's authorisation for sub-processors, and return or deletion at the
end of service (Art. 28, https://gdpr-info.eu/art-28-gdpr/). APPI requires the
business to supervise anyone it entrusts personal data to (Art. 25) and
treats such entrustment as outside third-party provision only within the
purpose of use (Art. 27(5)).

Negative evidence: PPC gave LINE administrative guidance in April 2021 after
engineers at a contractor in China could reach Japanese users' data
(https://www.ppc.go.jp/news/press/2021/210423kouhou/), and in March 2024 issued
a recommendation to LINE Yahoo after malware at a Korean contractor led into
its systems through a shared authentication platform, with about 520,000
people's data leaked or possibly leaked
(https://www.ppc.go.jp/files/pdf/240328_houdou.pdf).

**Where CCPA changes the check:** California's AG held that letting third
parties run tracking on a retailer's site and app was a "sale" of personal
information, and Sephora paid USD 1.2 million in 2022 partly for ignoring
Global Privacy Control
(https://oag.ca.gov/news/press-releases/attorney-general-bonta-announces-settlement-sephora-part-ongoing-enforcement).
A business that sells or shares must treat a qualifying opt-out preference
signal, such as an HTTP header or JavaScript property, as a valid opt-out
(CCPA Regulations § 7025). **[defect]** When the project's terms say California
users are in scope, a new third-party tracker that does not check the opt-out
state (including the GPC signal) before sending is a finding.

## Consent and its record

**[defect] Processing that relies on consent waits for it and stops on
withdrawal.** Silence, pre-ticked boxes and default-on settings are not
consent (ICO,
https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/how-should-we-obtain-record-and-manage-consent/).
Withdrawal must be as easy as giving consent (GDPR Art. 7(3),
https://gdpr-info.eu/art-7-gdpr/).

**[defect] Consent is stored as a record, not a boolean.** The controller must
be able to show consent was given (Art. 7(1)), which the ICO breaks down into
who, when, how, what they were told (the versioned text shown), and whether
and when they withdrew. One consent per purpose, not one flag for everything.

Under APPI, prior consent is the default gate for acquiring 要配慮個人情報 (Art.
20(2)), handling beyond the purpose (Art. 18), and providing personal data to a
third party (Art. 27) or one abroad (Art. 28), each with listed exceptions.
Which basis applies is the owner's call; the code must record what was
collected and gate on it.

## Data subject requests

**[defect] A new store of personal data is wired into access, export and
erasure.** GDPR gives access with a copy (Art. 15,
https://gdpr-info.eu/art-15-gdpr/), erasure (Art. 17,
https://gdpr-info.eu/art-17-gdpr/) and, for data the person provided under
consent or contract, a structured machine-readable export (Art. 20,
https://gdpr-info.eu/art-20-gdpr/). APPI gives disclosure, including by
electronic record (Art. 33), and stopping use, deletion or third-party
provision (Art. 35). A table, index or vendor copy the export and erasure jobs
do not know about breaks the request silently.

**[defect] Erasure propagates to recipients.** The controller tells each
recipient about erasure unless that is impossible or disproportionate (Art.
19, https://gdpr-info.eu/art-19-gdpr/), and processors delete or return data
when the service ends (Art. 28(3)(g)). An erase job that stops at the
primary database is a finding when the trace found vendor copies.

**[silence] The request path meets its deadline.** GDPR allows one month,
extendable by two for complex or numerous requests (Art. 12(3),
https://gdpr-info.eu/art-12-gdpr/); APPI says without delay. A design that
batches requests quarterly misses both.

Negative evidence: Sweden's IMY fined Spotify SEK 58 million in 2023 because
its access responses did not explain clearly enough how and for what purposes
the data was used, though the data itself was released
(https://imy.se/en/news/administrative-fee-against-spotify). Export is the
data plus its purposes, recipients and retention (Art. 15(1)).

## Cross-border transfer

**[silence] The design states where personal data is stored and processed,
including vendors, backups and support access.** GDPR restricts transfers
outside the EU/EEA (Chapter V, Art. 44); APPI restricts provision to a third
party in a foreign country (Art. 28), and PPC's guideline asks the business
to understand the foreign country's regime when it handles data there
(通則編 10-7). The review states the regions and access paths it found; whether
the transfer is lawful is a question for the owner.

## Encryption is necessary, not sufficient

**[silence] A design that answers privacy with "it is encrypted" still states
minimisation, retention, access and deletion.** Encryption is one of the
measures GDPR Art. 32(1) lists
(https://gdpr-info.eu/art-32-gdpr/), but it protects against a loss of
confidentiality, not against the authorised system doing too much with the
data. NIST's Privacy Framework separates the two: privacy problems can arise
from data processing that is working as intended, and only part of privacy
risk overlaps with cybersecurity risk
(https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.01162020.pdf). Encryption at
rest does nothing for a log line the application writes in plaintext.

Ireland's DPC fined Meta EUR 91 million in 2024 for user passwords stored in
plaintext on internal systems, under Art. 5(1)(f) and 32(1)
(https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta);
credential storage findings go to `security-reviewer`.

## Access control and audit logs for personal data

**[defect] Internal access to personal data is authorised per purpose and
logged.** A new admin, support or debugging endpoint, a database role or a
contractor account that reads personal data needs authorisation narrower than
"staff", and an access record of who read what and when. GDPR Art. 32(4)
limits people acting under the controller to its instructions; PPC's
guideline lists access control, authentication, and access and operation logs
as technical and organisational measures (通則編 10-3, 10-6); NIST's Privacy
Framework lists determining and reviewing audit records (CT.DM-P8). The LINE
cases above are this failure through a contractor.

**[silence] Audit logs state their own fields and retention.** They hold
personal data too: record identifiers, not copies of the record.

## Test fixtures, seeds and snapshots

**[defect] Fixtures, seeds, snapshots and screenshots in the repository hold
synthetic data, not real people's.** A production dump, a real customer email
in a seed script, or a snapshot test that captured a live record copies
personal data into every clone and CI log. NIST SP 800-53 PM-25 asks
organisations to minimise personal data in testing, training and research and
to authorise each use of it
(https://github.com/usnistgov/oscal-content/blob/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json).
`security-reviewer` already skips fixtures clearly marked as test data; this
check is about values that are real.

## Children's data

**[silence] The design says whether children may use the service; if they
may, the review flags it to the owner.** GDPR sets 16 as the age for consent to
online services, which member states may lower to 13, with reasonable efforts
to verify parental consent (Art. 8, https://gdpr-info.eu/art-8-gdpr/). The
ICO's children's code expects high-privacy defaults, geolocation and profiling
off by default, and minimal collection
(https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/code-standards/).
APPI sets no age in its text; PPC's guideline asks for consent from a legal
guardian where a minor cannot judge the consequences (通則編 2-16). The TikTok
and OpenAI decisions above both turned partly on children.

## Threat modelling a design with LINDDUN

For a design or spec review, walk the data-flow diagram with LINDDUN's seven
threat categories — linking, identifying, non-repudiation, detecting, data
disclosure, unawareness, non-compliance (https://linddun.org/) — and name the
category in each finding beside the article it relates to. The OWASP Top 10
Privacy Risks (v2.0, 2021, a Lab project) is a cross-check list; its entries
for insufficient deletion, inability to access and modify data, and collecting
data not required for the consented purpose map to the sections above
(https://owasp.org/www-project-top-10-privacy-risks/).

## Routing legal judgment

Never write "this is lawful", "this needs consent" or "GDPR does not apply" as
a finding. Write the engineering fact (the field, the sink, the recipient, the
region, the missing deletion) and ask the owner the legal question with it:
which legal basis, whether a purpose is compatible, whether a region is
approved, whether children are in scope, whether California users are.

## Related

- `observability-patterns` — label cardinality and log, trace and metric
  design that the telemetry checks here sit on.
- `event-driven-patterns` — events and read models are copies that deletion
  must reach.
- `defense-in-depth` — validating and redacting at more than one layer.
- `security-reviewer` (agent) — credential storage, encryption choice,
  authorisation defects, and the Privacy section that reads this file.

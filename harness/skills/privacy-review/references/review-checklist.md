# privacy-review — review checklist

Derived from ../SKILL.md. Read by `security-reviewer` (its Privacy section) and `spec-reviewer` through the `change-review` skill when a change collects, stores, logs, shares, exports or deletes personal data, adds analytics or telemetry, a third-party SDK or an LLM call that receives user content, or changes retention (defects in a diff; silences and trade-offs in a design or spec review), and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md. Legal applicability and legal basis are never findings: ask the owner.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: privacy:online-id-treated-as-anonymous
  rule: Account ids, IPs, device ids, advertising ids and cookie ids are personal data.
  check: Code or comments label such an identifier "anonymous" or "non-personal" and send it to analytics, a vendor or a public surface without the telemetry, consent or third-party checks; under APPI, an identifier passed to a third party expected to link it to a person with no consent check (Art. 31).
  section: "## Classify every field"

- id: privacy:collected-not-read
  rule: Collect only what the feature reads.
  check: A new field, form input, event property or column is written by the change and not read anywhere on the feature path it was added for.
  section: "## Data minimisation and purpose limitation"

- id: privacy:new-purpose-reader
  rule: A new reader of existing personal data for a different purpose is reported with old and new purpose named.
  check: A new query, job, export or model-training pipeline reads personal data collected for another purpose (support contact reused for marketing, production records into training, fraud signals into ads). Report the two purposes; compatibility is a question for the owner.
  section: "## Data minimisation and purpose limitation"

- id: privacy:wide-default
  rule: Defaults are the narrowest setting.
  check: Optional collection defaults on, profile or content visibility defaults public, or a setting exposes personal data to an unlimited audience without the person acting.
  section: "## Data minimisation and purpose limitation"

- id: privacy:telemetry-carries-pii
  rule: Logs, span attributes, error-report context and analytics events do not carry personal data or credentials by default.
  check: A log call, span attribute, breadcrumb, error context or analytics property includes session ids, tokens, passwords, keys, connection strings, government ids, health or payment data, special-category data, or names, emails or phone numbers not needed for the investigation.
  section: "## Personal data in logs, traces, metrics, error reports and analytics"

- id: privacy:object-dump-logging
  rule: Log by allow-list, not by object dump.
  check: Whole user, request, header map or body objects logged or attached (`%+v`, `JSON.stringify(req)`, `logger.info(user)`, request-body capture on); URL query strings, `Authorization` or `Cookie` headers, or user free text written to telemetry.
  section: "## Personal data in logs, traces, metrics, error reports and analytics"

- id: privacy:vendor-side-scrub-only
  rule: Redact before data leaves your environment; vendor-side scrubbing is a second layer.
  check: Redaction exists only as vendor UI or server-side rules with no SDK hook (`before_send` or equivalent) or collector processor in your environment; an SDK default-PII option (e.g. Sentry `send_default_pii`) turned on with no stated need.
  section: "## Personal data in logs, traces, metrics, error reports and analytics"

- id: privacy:pii-metric-label
  rule: Metrics labels never hold a person's identifier.
  check: A metric label value built from user id, email, IP, phone or session id.
  section: "## Personal data in logs, traces, metrics, error reports and analytics"

- id: privacy:pseudonymised-excluded-from-rights
  rule: Pseudonymised data is still personal data.
  check: A table, export or dataset holding hashed, tokenised or key-coded identifiers is excluded from retention, deletion, export or access jobs, or described as anonymous, on the ground that identifiers were replaced.
  section: "## Pseudonymisation is not anonymisation"

- id: privacy:unkeyed-hash-pseudonym
  rule: An unkeyed hash of a low-entropy identifier is not a pseudonym.
  check: Plain SHA-*/MD5 of email, phone, name or sequential user id used as a pseudonym or "anonymous id" with no secret key (HMAC) or random-token lookup table; or the key stored beside the pseudonymised data.
  section: "## Pseudonymisation is not anonymisation"

- id: privacy:store-without-retention
  rule: Every new store of personal data has an enforced retention.
  check: A new table, bucket, cache, queue, search index or analytics dataset holding personal data with no TTL, partition expiry, lifecycle rule or scheduled delete; a soft-delete flag with no purge job.
  section: "## Retention and deletion"

- id: privacy:deletion-misses-copy
  rule: Deletion reaches every copy.
  check: The delete or expiry path does not cover a copy the trace found: cache, search index, read model, warehouse or analytics copy, export, vector embedding, prompt or completion log, vendor copy.
  section: "## Retention and deletion"

- id: privacy:recoverable-deletion
  rule: Deletion cannot be undone and is recorded.
  check: "Deletion" that only hides or flags a record, moves it offline or to an archive, or leaves it recoverable; no record that the deletion happened.
  section: "## Retention and deletion"

- id: privacy:prompt-over-collects
  rule: An LLM prompt carries only the personal data the task needs.
  check: A whole user record, other users' data, contact details or a history longer than the task needs placed into a model prompt or tool result sent to a model vendor.
  section: "## LLM calls that receive user content"

- id: privacy:prompt-log-unmanaged
  rule: Prompt and completion logs are personal-data stores.
  check: Prompts or completions logged or persisted in full with no redaction, no retention, and no place in the deletion and export paths.
  section: "## LLM calls that receive user content"

- id: privacy:sdk-before-basis
  rule: An SDK that collects on its own starts only after the basis for it exists.
  check: An analytics, advertising, attribution or session-replay SDK initialised at app start or page load before the consent state is read, where the design names consent as the basis; its PII collection switch turned on with no stated need.
  section: "## Third-party SDKs and subprocessors"

- id: privacy:tracker-ignores-opt-out
  rule: Where California users are in scope, a third-party tracker checks the opt-out state, including the GPC signal, before sending.
  check: Project terms put California users in scope and a new third-party tracker sends data without reading the stored opt-out or the GPC signal (sent as an HTTP header and exposed as a JavaScript property).
  section: "## Third-party SDKs and subprocessors"

- id: privacy:consent-not-gating
  rule: Processing that relies on consent waits for it and stops on withdrawal.
  check: Consent-based processing runs before consent is recorded, continues after withdrawal, or is enabled by a pre-ticked or default-on control; withdrawal harder than giving consent.
  section: "## Consent and its record"

- id: privacy:consent-as-boolean
  rule: Consent is stored as a record, not a boolean.
  check: Consent stored as a single flag without who, when, how, the versioned text shown, and withdrawal time; one flag covering several purposes.
  section: "## Consent and its record"

- id: privacy:store-not-in-dsr
  rule: A new store of personal data is wired into access, export and erasure.
  check: A new table, index, bucket or vendor integration holding personal data that the access/export and erasure jobs do not read or delete.
  section: "## Data subject requests"

- id: privacy:erasure-not-propagated
  rule: Erasure propagates to recipients.
  check: The erase path stops at the primary database while the trace found processors, vendors or downstream services holding copies; no call, event or ticket that tells them.
  section: "## Data subject requests"

- id: privacy:internal-access-unscoped
  rule: Internal access to personal data is authorised per purpose and logged.
  check: A new admin, support or debug endpoint, database role or contractor account reads personal data with authorisation no narrower than "staff" or no access record of who read what and when.
  section: "## Access control and audit logs for personal data"

- id: privacy:real-data-in-fixtures
  rule: Fixtures, seeds, snapshots and screenshots hold synthetic data.
  check: A production dump, real customer email, phone, address or name in seed scripts, fixtures, snapshot files, recorded HTTP cassettes or committed screenshots.
  section: "## Test fixtures, seeds and snapshots"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: privacy:field-class-unstated
  rule: Each new field states its class (personal, special category / 要配慮個人情報, credential) and purpose.
  check: List every new field holding data about people; flag each with no stated class or purpose.
  section: "## Classify every field"

- id: privacy:telemetry-retention-unstated
  rule: Telemetry retention is stated and does not outlive the source data's purpose.
  check: Logs, traces, error reports or analytics that may carry personal data with no stated retention, or one longer than the source data's.
  section: "## Personal data in logs, traces, metrics, error reports and analytics"

- id: privacy:appi-processed-form-unstated
  rule: A design that uses 仮名加工情報 or 匿名加工情報 states which and why.
  check: The design uses either term, or "pseudonymised" / "anonymised" for a Japan-scoped dataset, without saying which statutory form it means; whether it meets the processing standard is an owner question.
  section: "## Pseudonymisation is not anonymisation"

- id: privacy:backup-retention-unstated
  rule: Backups have a stated retention, and a restore does not bring erased data back.
  check: Backups of a store with personal data have no stated retention, or no plan (short expiry, deletion-log replay) for erased records after a restore.
  section: "## Retention and deletion"

- id: privacy:llm-vendor-terms-unstated
  rule: The design names the model vendor, training use of inputs, vendor retention and processing region.
  check: An LLM feature receives user content and the design does not state these four facts.
  section: "## LLM calls that receive user content"

- id: privacy:subprocessor-unstated
  rule: A new subprocessor is named with what it receives, why, and where.
  check: A new vendor, SaaS, contractor or SDK receives personal data and the design does not name it, the data, the purpose and the region.
  section: "## Third-party SDKs and subprocessors"

- id: privacy:dsr-deadline-unstated
  rule: The request path meets its deadline.
  check: An access, export or erasure flow with no stated turnaround, or one longer than one month (GDPR) / not "without delay" (APPI).
  section: "## Data subject requests"

- id: privacy:transfer-unstated
  rule: The design states where personal data is stored and processed, including vendors, backups and support access.
  check: New storage, vendor, region or support access path with no stated location; lawfulness is an owner question.
  section: "## Cross-border transfer"

- id: privacy:encryption-as-answer
  rule: "Encrypted" does not replace minimisation, retention, access and deletion.
  check: The design's privacy answer is encryption at rest or in transit, with minimisation, retention, access and deletion left unstated.
  section: "## Encryption is necessary, not sufficient"

- id: privacy:audit-log-content-unstated
  rule: Audit logs state their own fields and retention.
  check: A new access or audit log with no stated fields (identifiers, not record copies) or retention.
  section: "## Access control and audit logs for personal data"

- id: privacy:children-unstated
  rule: The design says whether children may use the service.
  check: A consumer-facing feature with no statement on children; if children may use it, flag to the owner (GDPR Art. 8 age, ICO children's code defaults, PPC guardian consent).
  section: "## Children's data"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: privacy:pseudonym-technique
  rule: How to replace an identifier in analytics or shared datasets.
  options: keyed one-way function / HMAC (joinable across datasets, key must be protected and rotated) | random token with secret lookup table (no key to brute-force, table is a sensitive store) | truncate or generalise (no secret at all, loses joins and precision) | aggregate only (least risk, no per-person analysis)
  section: "## Pseudonymisation is not anonymisation"

- id: privacy:erasure-method
  rule: How erasure is carried out.
  options: hard delete everywhere (clearest, must reach every copy and backup) | anonymise in place (keeps aggregates, must truly prevent re-identification — removing the name alone did not) | crypto-shredding per person (reaches backups by destroying the key, needs per-person keys and key management)
  section: "## Retention and deletion", "## Data subject requests"

- id: privacy:redaction-layer
  rule: Where telemetry redaction runs.
  options: at the call site / SDK hook (data never leaves the process, needs code changes and review discipline) | in a collector you run (central allow-list, data crosses your own network first) | vendor-side rules only as a second layer (fast to change, data already sent)
  section: "## Personal data in logs, traces, metrics, error reports and analytics"

- id: privacy:backup-erasure
  rule: How backups honour erasure.
  options: short backup expiry (simple, limits recovery window) | deletion-log replay after restore (keeps long backups, the log itself must be minimal) | per-person encryption keys (erasure by key deletion, adds key management)
  section: "## Retention and deletion"

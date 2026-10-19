# ai-feature-review — review checklist

Derived from ../SKILL.md. Read by `code-reviewer`, `security-reviewer` and `workload-reviewer` through the `change-review` skill when a diff adds or changes an LLM feature — prompts, model calls, tool or function calling, agents, RAG retrieval, structured output parsing, model output used as input to code, evals, model or provider configuration (defects in a diff; silences and trade-offs in a design or spec review) — and by `grilling` (trade-offs). Security items (injection, output handling, tools, retrieval, secrets) go to `security-reviewer`; cost, rate-limit, retry, fallback and streaming items to `workload-reviewer`; the rest to `code-reviewer`. Personal data in prompts and prompt logs is `privacy-review`'s checklist, not this one. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: ai:lethal-trifecta
  rule: Private data, untrusted content and an exfiltration channel never meet in one model context.
  check: For each model context in the diff, list what it can read (user records, other tenants, internal docs), what untrusted text enters it (web pages, email, uploads, tickets, retrieved chunks, tool results), and what can leave (outbound tools, URL fetch, rendered images or links, email). Flag a context that has all three; a "ignore instructions in the content" prompt does not remove a leg.
  section: "## Prompt injection and the lethal trifecta"

- id: ai:untrusted-input-selects-actions
  rule: Once the agent has read untrusted input, that input cannot select consequential actions.
  check: An agent loop that reads untrusted content and then chooses freely among write or outbound tools in the same context, with no action-selector, plan-then-execute, map-reduce, dual-LLM, taint-tracked code or context-minimisation structure.
  section: "## Prompt injection and the lethal trifecta"

- id: ai:untrusted-in-instruction-channel
  rule: Untrusted content stays in the data channel and is marked as data.
  check: Tool output, retrieved text, file contents or user-supplied documents interpolated into the system prompt or into instruction text by string concatenation instead of a tool-result or clearly delimited data block.
  section: "## Prompt injection and the lethal trifecta"

- id: ai:system-prompt-as-control
  rule: The system prompt is neither a secret nor a control.
  check: Credentials, connection strings, other users' data, or role and permission rules in a system prompt; authorization expressed only as a prompt instruction ("do not show admin data to non-admins") with no code check.
  section: "## Prompt injection and the lethal trifecta"

- id: ai:output-to-code-sink
  rule: Model output never reaches eval, exec, a shell, a template compiler or a deserialiser.
  check: Model text passed to eval/exec/Function, subprocess/os.system, a template engine, pickle/yaml.load; generated SQL run without parameters or under a role with write rights the feature does not need; a generated URL fetched server-side without the host allow-list; generated code run outside a credential-free sandbox.
  section: "## Model output is untrusted input"

- id: ai:output-rendered-unescaped
  rule: Rendered output is escaped, and external images and links are not auto-loaded.
  check: Model Markdown or HTML rendered with dangerouslySetInnerHTML, v-html, |safe, innerHTML or a Markdown renderer with raw HTML on; image tags or Markdown images to arbitrary hosts rendered automatically; reliance on a CSP allow-list alone (check allowed domains for open redirects and expired registrations).
  section: "## Model output is untrusted input"

- id: ai:structured-output-unvalidated
  rule: Structured output is schema-validated in code before use.
  check: Model JSON parsed with a bare JSON.parse / json.loads and indexed without a schema validator (zod, pydantic, JSON Schema); no use of the provider's strict structured-output mode where available; numeric or length bounds relied on from the schema although the provider does not enforce them; enums compared case-sensitively.
  section: "## Model output is untrusted input"

- id: ai:stop-reason-ignored
  rule: Every stop or finish reason has a branch.
  check: Response text read without checking stop_reason / finish_reason / status — no handling of max_tokens or incomplete (truncation), refusal, content_filter.
  section: "## Model output is untrusted input"

- id: ai:tool-too-broad
  rule: Each tool is the narrowest one that does the job.
  check: An open-ended tool (run shell command, fetch any URL, run arbitrary SQL, write any file) where a purpose-built one would do; a tool registered but never needed by the feature; a read task given a credential or OAuth scope with write or delete rights.
  section: "## Tools and agency"

- id: ai:tool-shared-identity
  rule: Tools act with the end user's identity and rights, and authorization is enforced downstream in code.
  check: Tool handlers that call downstream systems with a shared service account or admin token; a tool that trusts the model's choice of user, tenant or record without checking the caller's rights in the handler.
  section: "## Tools and agency"

- id: ai:side-effect-without-confirmation
  rule: Side-effecting tools need explicit human confirmation of the concrete action.
  check: Send, delete, pay, publish, merge, permission-change or external-write tools executed directly from a model tool call with no approval step; an approval step that shows the model's summary rather than the actual action and arguments.
  section: "## Tools and agency"

- id: ai:tool-not-idempotent
  rule: Write tools are idempotent or carry an idempotency key.
  check: A write tool whose handler creates or sends without a dedup key derived from the tool-call id or the business operation, in a loop that can retry an invalid call, receive parallel calls, or resume after a timeout.
  section: "## Tools and agency"

- id: ai:tool-args-unchecked
  rule: Tool arguments are validated like request parameters.
  check: A path, record id, recipient, amount or URL from tool arguments used without ownership and bounds checks in the handler; strict mode off where the provider offers it.
  section: "## Tools and agency"

- id: ai:tool-error-swallowed
  rule: Tool errors return as error results, not loop-ending exceptions or silent empties.
  check: A tool handler that raises out of the agent loop, or returns an empty or success-shaped result on failure, instead of an error result (is_error: true) saying what failed.
  section: "## Tools and agency"

- id: ai:agent-loop-unbounded
  rule: An agent loop has a bound on turns, tool calls and tokens or cost per task.
  check: while/for loop over model calls with no max turns, no max tool calls, and no per-task token or cost ceiling that stops and reports.
  section: "## Tools and agency"

- id: ai:retrieval-ignores-permissions
  rule: Retrieval filters by the caller's permissions before content reaches the prompt.
  check: A vector or keyword search over a store shared by tenants, roles or users with no tenant or ACL filter in the query; filtering done by asking the model to ignore chunks.
  section: "## Retrieval (RAG)"

- id: ai:retrieved-content-trusted
  rule: Retrieved documents are untrusted content.
  check: An index fed by third-party-writable sources (uploads, tickets, web, email) whose chunks enter a context that also holds private data or outbound tools; ingestion that keeps hidden text (formatting-based) without extraction or validation.
  section: "## Retrieval (RAG)"

- id: ai:secret-in-context
  rule: No secret is placed in a prompt, tool result or tool definition.
  check: API keys, tokens, passwords or connection strings in prompt templates, tool descriptions, tool results or files attached to a model call.
  section: "## Data sent to the provider"

- id: ai:no-output-cap-or-timeout
  rule: Every model call sets an explicit output cap and a timeout.
  check: A model call with no max_tokens / max_output_tokens, or with the client's default (or no) timeout; a large output cap on a non-streaming call; no limit on input size from users.
  section: "## Cost and latency controls"

- id: ai:no-per-user-quota
  rule: User-facing features have a per-user quota and rate limit.
  check: An endpoint that triggers model calls with no per-user or per-tenant request or token limit and no alert on unusual consumption.
  section: "## Cost and latency controls"

- id: ai:retry-stacked
  rule: Retries happen in one layer.
  check: An application retry loop around a provider SDK that already retries (Anthropic SDK: 2 retries by default), or behind a gateway (LiteLLM, a proxy) that also retries, without disabling the others.
  section: "## Cost and latency controls"

- id: ai:retry-non-retryable
  rule: Non-retryable LLM errors are not retried.
  check: Retry predicate that retries 400 (invalid request or spend limit), 401, 403, or a 429 without retry-after from a spend cap.
  section: "## Cost and latency controls"

- id: ai:prompt-cache-defeated
  rule: Prompt caching is laid out so it can hit, and its hit rate is measured.
  check: A timestamp, request id, user-specific text or nondeterministically ordered tool list placed before the cache breakpoint; tools, tool_choice or output format changing per request in a cached conversation; caching enabled with no reading of cache_read_input_tokens / cache_creation_input_tokens.
  section: "## Cost and latency controls"

- id: ai:fallback-to-other-model
  rule: Never fall back to a different model automatically where quality matters.
  check: Router or gateway config with fallbacks to another model or model group; a catch block that retries with a different model name; any automatic switch away from the configured model instead of retrying the same model's other deployment and then failing with the deployment and cause named (house rule: harness/rules/decisions/2026-10-19-model-assignment.md).
  section: "## Rate limits, failures and fallback"

- id: ai:served-model-unrecorded
  rule: The model that actually answered is recorded.
  check: Responses logged or traced without the response's model name and, behind a proxy, the deployment that served it.
  section: "## Rate limits, failures and fallback"

- id: ai:model-unpinned
  rule: The model id is pinned where behaviour matters.
  check: A floating alias (-latest, a family name without version) in production config; the model id repeated as literals across files instead of one config value.
  section: "## Determinism, pinning and deprecation"

- id: ai:model-deprecated
  rule: A deprecated or soon-retired model id is not introduced, and pinned ids have a tracked retirement date.
  check: A model id the provider's deprecations page lists as deprecated or retired on the platform the code calls (Anthropic API, Bedrock and Vertex differ); a new pinned id with no recorded retirement date.
  section: "## Determinism, pinning and deprecation"

- id: ai:sampling-param-unsupported
  rule: Sampling parameters are ones the pinned model accepts.
  check: temperature, top_p or top_k set to a non-default value for a Claude 4.7-or-later model, or kept from an older model across a model upgrade.
  section: "## Determinism, pinning and deprecation"

- id: ai:assumes-deterministic-output
  rule: Code and tests do not assume identical output for identical input.
  check: Exact-string assertions on live model output; logic or caches that rely on temperature 0 returning the same text twice.
  section: "## Determinism, pinning and deprecation"

- id: ai:prompt-change-without-eval
  rule: A prompt, model, tool-definition or retrieval change runs the eval set before merge.
  check: A diff that changes a prompt template, model id, tool schema or description, or retrieval parameters, with no eval or golden-set run in CI or the PR. A finding where an eval suite exists; a question where none does.
  section: "## Evals as tests"

- id: ai:judge-where-code-would-do
  rule: Graders are code where the answer is checkable.
  check: An LLM judge scoring schema validity, exact answers, citation existence or tool-call arguments that code could check.
  section: "## Evals as tests"

- id: ai:judge-bias-uncontrolled
  rule: An LLM judge is controlled for its known biases.
  check: Pairwise judging in one order only; the judge is the same model as the system under test; no rubric or anchored scale; free-form judge output parsed loosely.
  section: "## Evals as tests"

- id: ai:no-injection-evals
  rule: Injection cases are in the eval set when the feature reads untrusted content.
  check: A feature that reads web pages, files, email or retrieved third-party text with no adversarial cases that try to override instructions or trigger tools.
  section: "## Evals as tests"

- id: ai:ungrounded-binding-facts
  rule: Answers about facts the business is bound by come from retrieved or stored sources.
  check: Prices, policy, eligibility, legal or medical answers generated from the model's own knowledge with no retrieval from an authoritative source and no validation of the key values.
  section: "## Hallucination and grounding"

- id: ai:no-refusal-path
  rule: There is a refusal path.
  check: Prompt or schema that forces an answer in every case (no "unknown" value, no permission to decline); code that treats a decline as an error or retries until an answer appears.
  section: "## Hallucination and grounding"

- id: ai:stream-error-after-200
  rule: Errors after HTTP 200 are handled.
  check: Streaming consumer with no handling for an error event mid-stream; a UI that shows a partial answer as complete after the stream ends abnormally.
  section: "## Streaming and partial output"

- id: ai:tool-input-parsed-early
  rule: Streamed tool input is parsed only when its block ends.
  check: input_json_delta / argument deltas parsed or executed before content_block_stop (or the provider's equivalent), without a partial-JSON parser.
  section: "## Streaming and partial output"

- id: ai:acts-on-partial-output
  rule: Side effects, persistence and output encoding wait for the final message or are safe on a prefix.
  check: Saving, sending or executing based on streamed text before the final message; streamed chunks rendered without the escaping and image rules.
  section: "## Streaming and partial output"

- id: ai:unknown-stream-event-fatal
  rule: Unknown stream event types are ignored, not fatal.
  check: A stream parser that throws or ends on an unrecognised event type.
  section: "## Streaming and partial output"

- id: ai:call-telemetry-missing
  rule: Each call records model requested, model served, token usage including cache, latency, finish reason and the provider's request id.
  check: A new model call path with none of these recorded, or with only a log line of the prompt.
  section: "## Observability"

- id: ai:content-captured-unredacted
  rule: Prompt and completion content is captured only by opt-in and with redaction.
  check: Full prompts, completions, system instructions or retrieval queries written to logs or span attributes by default, with no opt-in switch and no redaction.
  section: "## Observability"

- id: ai:agent-actions-unlogged
  rule: Tool calls by an agent are logged with arguments, result status and acting identity.
  check: An agent loop whose tool executions leave no record of which tool ran, with what arguments, as whom, and whether it succeeded.
  section: "## Observability"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: ai:input-trust-unstated
  rule: A design names the trust level of every input that reaches the model and which tools stay reachable after it is read.
  check: List each input source the design feeds to a model; flag any without a trust level, and any untrusted source with no statement of which tools remain callable after it.
  section: "## Prompt injection and the lethal trifecta"

- id: ai:tool-inventory-unstated
  rule: A design lists every tool with its permission, side effect, confirmation need and acting identity.
  check: Tools named without one of the four facts, especially a write tool with no confirmation decision.
  section: "## Tools and agency"

- id: ai:index-sources-unstated
  rule: A RAG design states which sources feed the index, who can write to each, and how a source deletion reaches the index.
  check: An index described without its sources' writers or a deletion path.
  section: "## Retrieval (RAG)"

- id: ai:cost-envelope-unstated
  rule: A design states expected tokens per request, requests per user, the monthly ceiling and the behaviour at the ceiling.
  check: An LLM feature design with no token or cost estimate, or no stated behaviour when the budget is reached.
  section: "## Cost and latency controls"

- id: ai:success-metric-unstated
  rule: A design states the eval's success metric and threshold.
  check: Quality described as "accurate" or "good" with no measurable metric, dataset and threshold.
  section: "## Evals as tests"

- id: ai:grounding-method-unstated
  rule: A grounded feature states how claims are tied to sources.
  check: A RAG or answer feature design with no statement of citations shown, and of what happens to a claim with no supporting source.
  section: "## Hallucination and grounding"

- id: ai:disclosure-unstated
  rule: A user-facing feature states whether and how users are told they are dealing with AI.
  check: A chatbot, generated media or published AI text with no disclosure decision. Whether the EU AI Act applies is a question for the owner.
  section: "## Disclosure of AI output"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: ai:degrade-when-model-down
  rule: Behaviour when the configured model is unavailable.
  options: explicit error (honest, feature unavailable) | deterministic non-LLM path such as search results or a template (keeps a useful answer, needs building and exercising) | queue and complete later (no loss, delayed and needs a notification path). Switching to another model is not an option for quality-sensitive work.
  section: "## Rate limits, failures and fallback"

- id: ai:grounding-verification
  rule: Where grounding is verified.
  options: code check that each cited span exists in the source (cheap, catches invented citations, misses misreadings) | second-model check (catches more, costs a call, shares failure modes) | show sources to the user (cheapest, moves verification to the reader)
  section: "## Hallucination and grounding"

- id: ai:disclosure-strength
  rule: How strongly AI output is disclosed.
  options: persistent label on every AI message (clear, adds noise) | one-time notice at first interaction (minimum for the chatbot case, easy to forget later) | machine-readable marking only (meets the marking duty for generated media, invisible to readers)
  section: "## Disclosure of AI output"

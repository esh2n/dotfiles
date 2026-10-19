---
name: ai-feature-review
description: Use when a change adds or changes an LLM feature — a prompt or system prompt, a model API call, tool or function calling, an agent loop, RAG retrieval, structured output parsing, model output passed to code, HTML, SQL or a shell, an eval or golden set, or model, provider, fallback, caching or token-limit configuration — and when judging prompt injection and the lethal trifecta, excessive agency, what data reaches a provider, cost and rate-limit controls, model pinning and deprecation, hallucination handling, streaming, LLM observability or AI disclosure.
metadata:
  namespaces: [practice]
---

# AI Feature Review

Judgment criteria for application code that calls a language model. The model
is a component that follows whatever text reaches it and returns text nobody
wrote, so the review question is always what the surrounding code allows when
the model is wrong or has been steered by an attacker. Sources were opened on
2026-10-19; vendor parameter names are from that date.

Routing. `security-reviewer` already carries one LLM row (trifecta, untrusted
output, least privilege, approval for destructive actions); this file holds
the detailed criteria behind it, and security findings cite `ai:<slug>` beside
the CWE or OWASP id. Personal data sent to a provider, prompt logs as
personal-data stores and vendor training and retention terms belong to
`privacy-review` (`privacy:prompt-over-collects`,
`privacy:prompt-log-unmanaged`, `privacy:llm-vendor-terms-unstated`); this
file does not repeat them. Timeouts, retry budgets and jitter in general are
`resilience-patterns`; only the LLM-specific parts are here.
`ai-regression-testing` is about testing code an AI agent wrote, not about
evaluating a model feature's output; evals are covered below.

## Prompt injection and the lethal trifecta

Prompt injection is direct when the user's own input changes the model's
behaviour, and indirect when the instructions arrive inside content the model
reads — a web page, a file, an email, a retrieved document, a tool result
(https://genai.owasp.org/llmrisk/llm01-prompt-injection/). No filter or
classifier removes it reliably; detection that stops 95% of attacks is a
failing grade by web-security standards
(https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/).

**[defect] Private data, untrusted content and an exfiltration channel never
meet in one model context.** This is the lethal trifecta: when a single
context holds data the attacker should not see, text the attacker can write,
and any way to send data out (an outbound tool, a URL fetch, a rendered image
or link, an email), injected text can make the model leak the data
(https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/). Check it as a
design property: list what the context can read, what untrusted text enters it,
and what can leave it. Removing any one leg is the fix; a prompt telling the
model to ignore injected instructions is not.

EchoLeak (CVE-2025-32711, Microsoft 365 Copilot) is the reference incident: an
inbound email carried instructions written to the human reader so the
injection classifier passed it, retrieval pulled the email into context next
to the user's private data, and the model wrote that data into a Markdown
image URL that the client fetched through an open redirect on a domain the
CSP allowed — zero clicks
(https://simonwillison.net/2025/Jun/11/echoleak/). The CVE record itself did
not load in this run and is unverified here.

**[defect] Once the agent has read untrusted input, that input cannot select
consequential actions.** The accepted structures each cut the path from
untrusted text to tool choice: action-selector (the model never sees tool
output), plan-then-execute (the tool sequence is fixed before untrusted text is
read), map-reduce (each untrusted item is handled by an isolated call that
returns a constrained value), dual LLM (a quarantined model reads untrusted
text and returns references only), code-then-execute with taint tracking, and
context minimisation (drop the raw request once it has been turned into a
query) (https://simonwillison.net/2025/Jun/13/prompt-injection-design-patterns/).
A diff where a model reads a web page, inbox or ticket and then chooses freely
among write tools has none of these.

**[defect] Untrusted content stays in the data channel and is marked as
data.** Put tool output and retrieved text in tool-result blocks, never in the
system prompt or concatenated into the instruction text
(https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).
Microsoft's spotlighting — random delimiters, interleaved markers, or encoding
of untrusted text — lowers the success rate but is probabilistic; it is a
layer under the design above, not a replacement
(https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks).

**[defect] The system prompt is neither a secret nor a control.** Credentials,
connection strings, other users' data and role or permission rules do not go in
it, and authorization is never "the prompt tells the model not to"; both must
hold when the prompt leaks or is overridden
(https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/).

**[silence] A design names the trust level of every input that reaches the
model** — user text, retrieved documents, tool results, files, web pages — and
for each one which tools stay reachable after it is read.

## Model output is untrusted input

**[defect] Model output never reaches `eval`, `exec`, a shell, a template
compiler or a deserialiser.** Treat it exactly like a request body from an
anonymous user: validate, then encode for the sink
(https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/).
Generated SQL runs parameterised, under a read-only role scoped to what the
feature needs; generated URLs go through the same host allow-list as any
server-side fetch (SSRF, `security-reviewer`); generated code runs only in a
sandbox with no credentials.

**[defect] Rendered output is escaped, and external images and links are not
auto-loaded.** Rendering model Markdown or HTML as-is is XSS when the model is
steered into emitting script, and an auto-loaded image is an exfiltration
channel even with script blocked: the query string carries the data. The
incident list is long — Microsoft 365 Copilot, GitLab Duo, Salesforce
Agentforce, Claude iOS, Mistral Le Chat, Google Antigravity, Superhuman,
Copilot Cowork (https://simonwillison.net/tags/markdown-exfiltration/). Google
stopped rendering external image URLs in Gemini and redacts suspicious links
(https://blog.google/security/mitigating-prompt-injection-attacks/); Microsoft
blocked the image technique deterministically
(https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks).
A CSP allow-list is not enough on its own: EchoLeak passed through an open
redirect on an allowed domain and Agentforce through an expired domain the CSP
still trusted (https://simonwillison.net/tags/markdown-exfiltration/).

**[defect] Structured output is schema-validated in code before use.** Use the
provider's constrained decoding where it exists — Anthropic
`output_config.format` with a JSON schema and `strict: true` on tools
(https://platform.claude.com/docs/en/docs/build-with-claude/structured-outputs),
OpenAI `json_schema` with `strict: true`
(https://developers.openai.com/api/docs/guides/structured-outputs) — and still
validate, because both vendors document outputs that miss the schema: a
refusal (`stop_reason: "refusal"`, or a `refusal` content part) and truncation
at the token limit (`stop_reason: "max_tokens"`, `status: "incomplete"`).
Anthropic also notes enum values that differ only in case, and it rejects
numeric and string-length constraints in the schema, so those bounds have to
be checked client-side. Parsing with a bare `JSON.parse` / `json.loads` and
indexing into the result is the defect.

**[defect] Every `stop_reason` / finish reason has a branch.** `max_tokens`,
`refusal`, `content_filter` and `tool_use` each
mean the text is not a complete answer; code that reads the text without
checking the reason ships truncated or refused output as if it were final
(https://platform.claude.com/docs/en/docs/build-with-claude/structured-outputs,
https://developers.openai.com/api/docs/guides/structured-outputs).

## Tools and agency

OWASP names three root causes of excessive agency: tools the task does not
need, tools with more permission than the task needs, and high-impact actions
taken without independent checks or confirmation
(https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

**[defect] Each tool is the narrowest one that does the job.** Open-ended tools
— run a shell command, fetch any URL, run any SQL — are replaced by
purpose-built ones; tools the feature does not call are removed; a read task
gets a read-only credential or OAuth scope
(https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

**[defect] Tools act with the end user's identity and rights, and
authorization is enforced downstream in code.** A shared service account lets
an injected instruction reach every tenant's data; the model deciding whether a
call is allowed is not authorization
(https://genai.owasp.org/llmrisk/llm062025-excessive-agency/,
https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/).

**[defect] Side-effecting tools need explicit human confirmation.** Sending a
message, deleting, paying, changing permissions, publishing or merging waits
for the user to approve the concrete action, shown with its arguments. OWASP,
Google (user confirmation framework) and Microsoft (Outlook drafts, the user
sends) all use this as the layer that holds when detection fails
(https://genai.owasp.org/llmrisk/llm062025-excessive-agency/,
https://blog.google/security/mitigating-prompt-injection-attacks/,
https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks).
Approval that shows only the model's summary of the action, not the action, can
itself be steered.

**[defect] Write tools are idempotent or carry an idempotency key.** The same
call can arrive twice: the model retries an invalid call two or three times
on its own (https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls),
a response may hold several calls at once
(https://developers.openai.com/api/docs/guides/function-calling), and an agent
loop that resumes after a timeout replays the last step. Derive the key from
the tool-call id or the business operation; the general rule is
`resilience-patterns` ("## Retry judgment") and `distributed-correctness`.

**[defect] Tool arguments are validated like request parameters.** Even with
strict schemas, the values are model-chosen: a path, record id or recipient
inside the schema can still name another user's resource. Check ownership and
bounds in the tool handler. Enable strict mode where offered — OpenAI
recommends it always
(https://developers.openai.com/api/docs/guides/function-calling).

**[defect] Tool errors return as error results, not exceptions that end the
loop or as silent empties.** Return `is_error: true` with what went wrong and
what to try next; an empty success result teaches the model the action worked
(https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).

**[defect] An agent loop has a bound.** A maximum number of turns, tool calls
and total tokens or cost per task, after which it stops and reports; without
it, a model that keeps calling tools runs until the budget of the account is
gone (https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/).

**[silence] A design lists every tool with its permission, its side effect,
whether it needs confirmation, and the identity it acts as.**

## Retrieval (RAG)

**[defect] Retrieval filters by the caller's permissions before content
reaches the prompt.** A vector store shared across tenants or roles returns
another group's chunks unless the query is partitioned or filtered by access
level; the model cannot be asked to ignore what it was given
(https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/).

**[defect] Retrieved documents are untrusted content.** Anything a third party
can write — uploaded files, résumés, tickets, web pages, emails — can carry
hidden instructions (white-on-white text in a résumé is OWASP's example); it is
a leg of the trifecta and falls under the injection rules above. Ingestion
extracts text without formatting tricks and validates sources
(https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/).

**[silence] A design states which sources feed the index, who can write to
each, and how a deletion at the source reaches the index** (the deletion part
is `privacy-review`'s trace).

## Data sent to the provider

Everything in the prompt, tool results and uploaded files leaves the process.
The checks — minimum personal data in the prompt, prompt logs as personal-data
stores, the vendor's training use, retention and region — are
`privacy-review` ("## LLM calls that receive user content").

**[defect] No secret is placed in a prompt, tool result or tool definition.**
API keys, tokens and connection strings in context are sent to the vendor,
written to its logs and any trace that captures content, and can be echoed back
by the model (https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/).

## Cost and latency controls

**[defect] Every model call sets an explicit output cap and a timeout.** A
missing `max_tokens` / `max_output_tokens` means the model's maximum per call;
OWASP lists input-size limits, timeouts and throttling against unbounded
consumption (https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/),
and OpenAI recommends capping input length and output tokens
(https://developers.openai.com/api/docs/guides/safety-best-practices). A large
cap on a non-streaming call also risks idle-connection drops; Anthropic's SDKs
refuse non-streaming requests expected to exceed ten minutes
(https://platform.claude.com/docs/en/api/errors).

**[defect] User-facing features have a per-user quota and rate limit.** One
account, script or injected loop can otherwise spend the whole budget
("denial of wallet"); limit requests and tokens per user or tenant, and alert
on unusual consumption
(https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/).

**[defect] Retries happen in one layer.** The Anthropic SDK already retries
connection errors, 429 and 5xx twice with exponential backoff and honours
`retry-after` (https://platform.claude.com/docs/en/api/errors); an
application retry loop around it, and a gateway such as LiteLLM behind it,
multiplies calls and cost. Turn off all but one layer
(`resilience-patterns`, `resilience:retry-stacked-layers`).

**[defect] Non-retryable LLM errors are not retried.** A 400 for an invalid
request or a reached spend limit, 401/403, and a 429 from a tier spend cap
(which has no `retry-after` and keeps failing until access resumes) fail the
same way every time (https://platform.claude.com/docs/en/api/errors).

**[defect] Prompt caching is laid out so it can hit, and its hit rate is
measured.** Anthropic caches the prefix in the order tools, system, messages;
a timestamp, request id or reordered tool list before the cache breakpoint
means it never hits, and changing tools, `tool_choice`, the output format or
thinking settings invalidates later levels. Prompts below the model's minimum
length are silently not cached; the only evidence is
`cache_read_input_tokens` / `cache_creation_input_tokens` in `usage`
(https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

**[silence] A design states the expected tokens per request, requests per user,
the monthly ceiling and what happens when it is reached.**

## Rate limits, failures and fallback

**[defect] Never fall back to a different model automatically where quality
matters.** When the configured model is unavailable, retry in one layer, then
try another deployment of the same model; when that fails too, stop with an
error that names the deployment and the cause. This is the house rule
(`harness/rules/decisions/2026-10-19-model-assignment.md`, section 4), and the
reasons it gives are failure modes a reviewer can look for: a fallback hides a
configuration error behind a 200 from the other model — LiteLLM falls back even
on its own `UnsupportedParamsError`, which fails identically on every call
(https://github.com/BerriAI/litellm/issues/44815) — the cache is lost, and
work continues on a weaker model with nobody told. A router config with
`fallbacks` to another model group, or a `catch` that swaps the model name, is
the defect.

**[defect] The model that actually answered is recorded.** Log or return the
response's model (`gen_ai.response.model` in OpenTelemetry) and, behind a
proxy, the deployment that served it; requested and served models can differ
(https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md).

**[trade-off] Degrade to a non-LLM path or fail visibly.** When the model is
unavailable a feature can return an explicit error, fall back to a
deterministic path (search results instead of a generated answer, a template
instead of a draft), or queue the work; switching models is not among the
options for quality-sensitive work. NIST AI 600-1 asks for fallback plans that
may include manual processing (GV-6.2-006,
https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf).

## Determinism, pinning and deprecation

**[defect] The model id is pinned where behaviour matters.** A floating alias
(`-latest`, a family name) changes behaviour under a fixed prompt without a
diff; pin the dated or versioned id, and keep it in configuration in one
place. NIST AI 600-1 lists the underlying foundation model and its version as
an inventory item (GV-1.6-003,
https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf).

**[defect] A deprecated or soon-retired model id is not introduced, and pinned
ids have a tracked retirement date.** Requests to a retired model fail;
Anthropic gives at least 60 days' notice and publishes retirement dates per
id (https://platform.claude.com/docs/en/about-claude/model-deprecations).
Partner platforms (Bedrock, Vertex) keep their own schedules, so check the one
the code calls.

**[defect] Sampling parameters are ones the pinned model accepts.** On Claude
4.7 and later, a non-default `temperature`, `top_p` or `top_k` returns 400, and
the Python SDK v1.0+ removed them
(https://platform.claude.com/docs/en/about-claude/model-deprecations). A model
upgrade that keeps an old `temperature: 0` breaks the call.

**[defect] Code and tests do not assume identical output for identical input.**
Temperature 0 does not give determinism on a shared server: batch size changes
with load and kernels are not batch-invariant, so 1,000 temperature-0
completions of one prompt produced 80 distinct outputs in one measurement
(https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/).
Exact-string assertions on live model output, and caches keyed on the
assumption that a re-run returns the same text, are flaky by construction.

## Evals as tests

**[defect] A prompt, model, tool-definition or retrieval change runs the eval
set before merge.** These changes alter behaviour with no type error; the
regression signal is a golden set scored automatically. Anthropic's guidance:
mirror the real task distribution including edge and adversarial cases,
automate grading, and prefer many automatically graded cases over a few hand-
graded ones (https://platform.claude.com/docs/en/test-and-evaluate/develop-tests).
A diff that edits a prompt with no eval or golden-set change is a finding when
the feature has an eval suite, and a question when it has none.

**[defect] Graders are code where the answer is checkable.** Exact match,
schema validity, a citation that resolves, a tool called with the right
arguments — these are cheaper and stable; an LLM judge is for qualities code
cannot check (https://platform.claude.com/docs/en/test-and-evaluate/develop-tests).

**[defect] An LLM judge is controlled for its known biases.** Position bias
(prefers the first or second answer), verbosity bias (prefers longer),
self-enhancement (prefers its own model's output) and weak reasoning on maths
and logic are documented (https://arxiv.org/abs/2306.05685). Swap answer order
and average, use a different model as the judge, anchor the scale with a
rubric, and constrain the judge's output format
(https://platform.claude.com/docs/en/test-and-evaluate/develop-tests). A judge
of the same model as the system under test, scoring one ordering, is the
defect.

**[defect] Injection cases are in the eval set** when the feature reads
untrusted content: adversarial inputs that try to override instructions or
trigger tools (https://genai.owasp.org/llmrisk/llm01-prompt-injection/,
https://developers.openai.com/api/docs/guides/safety-best-practices).

**[silence] A design states the success metric and threshold** (for example,
F1 on a held-out set) rather than "works well"
(https://platform.claude.com/docs/en/test-and-evaluate/develop-tests).

## Hallucination and grounding

The deployer owns what the model says. In Moffatt v. Air Canada (2024 BCCRT
149) the airline's website chatbot invented a retroactive bereavement-fare
refund; the tribunal rejected the argument that the chatbot was a separate
entity responsible for its own statements and held the airline liable for
negligent misrepresentation
(https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot;
the tribunal's decision on CanLII did not load and is unverified here).

**[defect] Answers about facts the business is bound by — prices, policy,
eligibility, legal or medical statements — come from retrieved or stored
sources, not the model's own knowledge.** OWASP LLM09 lists retrieval from
verified sources, automatic validation of key outputs and human review for
high-stakes content (https://genai.owasp.org/llmrisk/llm092025-misinformation/).

**[defect] There is a refusal path.** The prompt allows "I don't know" and the
code handles it as a normal outcome; a feature forced to always answer
fabricates (https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations).

**[silence] A grounded feature states how claims are tied to sources** —
citations shown to the user, and whether a claim with no supporting quote is
removed — (https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations).

**[trade-off] Verify grounding in code, with a second model, or by the user.**
A code check that each cited span exists in the source catches invented
citations but not misread ones; a second-model check costs a call and shares
failure modes; showing sources to the user is cheapest and moves the work to
them.

## Streaming and partial output

**[defect] Errors after HTTP 200 are handled.** A stream can end with an
`error` event (`overloaded_error`) after content has been sent; status-code
error handling never sees it
(https://platform.claude.com/docs/en/build-with-claude/streaming,
https://platform.claude.com/docs/en/api/errors). The UI marks the partial
answer as incomplete rather than presenting it as final.

**[defect] Streamed tool input is parsed only when its block ends.** Tool
arguments arrive as partial JSON strings; accumulate and parse at
`content_block_stop` (or use the SDK's partial parser), and never execute a
tool on a prefix (https://platform.claude.com/docs/en/build-with-claude/streaming).

**[defect] Side effects, persistence and output encoding wait for the final
message or are safe on a prefix.** Rendering partial Markdown still needs the
escaping and image rules above for each chunk; saving or acting on a partial
answer stores something the model did not finish.

**[defect] Unknown stream event types are ignored, not fatal.** Anthropic adds
event types under its versioning policy
(https://platform.claude.com/docs/en/build-with-claude/streaming).

## Observability

**[defect] Each call records model requested, model served, token usage
(including cache reads and writes), latency, finish reason and the provider's
request id.** OpenTelemetry's GenAI conventions name these attributes; they are
still at Development stability, so pin the semantic-conventions version
(https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md).
The request id is what the vendor's support asks for
(https://platform.claude.com/docs/en/api/errors).

**[defect] Prompt and completion content is captured only by opt-in and with
redaction.** The conventions mark input and output messages, system
instructions and retrieval queries as Opt-In and as likely to hold sensitive
or personal data
(https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md);
the retention and deletion side is `privacy:prompt-log-unmanaged`.

**[defect] Tool calls by an agent are logged with arguments, result status and
the identity they acted as**, so an injected action can be traced afterwards
(https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

## Disclosure of AI output

**[silence] A user-facing feature states whether and how users are told they
are dealing with AI.** From 2 August 2026, EU AI Act Article 50 requires
providers to tell people they are interacting with an AI system unless it is
obvious, to mark generated audio, image, video and text in a machine-readable
way, and deployers to disclose deepfakes and AI-written text published on
matters of public interest unless a human editor took responsibility
(https://artificialintelligenceact.eu/article/50/). OWASP LLM09 also lists
labelling AI content and stating its limits
(https://genai.owasp.org/llmrisk/llm092025-misinformation/). Whether the Act
applies is a question for the owner, never a finding.

**[trade-off] Disclosure strength.** A persistent label on every AI message
(clear, adds noise), a one-time notice at first interaction (minimum Article 50
asks for in the chatbot case, easy to miss later), or machine-readable marking
only (meets the marking duty for generated media, invisible to the reader).

## Related

- `security-reviewer` (agent) — its LLM row and the source-to-sink trace;
  SSRF, injection and secrets rules apply to model output and tool handlers.
- `privacy-review` — personal data in prompts, prompt logs, vendor terms.
- `resilience-patterns` — timeouts, retry budgets, jitter, rate limiting.
- `distributed-correctness` — idempotency keys for tool side effects.
- `observability-patterns` — span and metric design the LLM attributes sit in.
- `ai-regression-testing` — regression tests for code an AI agent wrote.

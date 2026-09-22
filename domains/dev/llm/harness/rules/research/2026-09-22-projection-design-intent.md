---
question: "jig projection layer の現行設計意図の再整理 — design.md/design-v2.md/decisions.mdのどれが正本で、コードは何を実装しているか"
date: 2026-09-22
verdict: "design-v2.mdがユーザー承認済みの正本で、native権限投影はeffect:permit→allowのみに縮小されている。実装中のpermissions.yaml/settings.layer.json/mcp.json/packsパイプラインはdesign.mdにもdesign-v2.mdにも一言も言及がなく、どちらの設計書からもサンクションされていない別系統の作業(未文書化)であることをgrep確認済み。"
unverified:
  - "Claude 'permissions.allow/deny' の生成元は permissions.yaml か guard-rules.json か、両ドキュメントとも未調整(2つの競合するソース)"
  - "glob化可能なforbid/askルールが、コアsubject抽出に加えてnative deny/askにも投影されるべきか design-v2は明言していない"
  - "regex→glob縮退(と capability report)が今も必要か — design-v2のcore側subject抽出への転換後、アルゴリズムも成果物形状も未規定"
  - "`jig apply --target claude` に --write パスを持たせるか、guard-hook登録も生成対象に含めるか"
  - "apply-claude.tsが既に持つenv/plugins/MCPサーバー/non-guardフックの構成がtask 001のスコープ内かどうか、両設計書とも未言及"
  - "requirements.md は今も空プレースホルダのまま — この task の要件は正式に一度も確定していない"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# jig projection layer — reconciled current design intent (2026-09-22)

Sources read: `spec/design.md`, `spec/design-v2.md` (APPROVED, D-8..D-21),
`spec/decisions.md` (D-1..D-7, D-1改/D-7 revisions), `spec/requirements.md`
(empty — unfilled placeholder), memory `harness-adapter-layer-design.md`,
`yoki-rebuild-jig.md`. Code checked: `jig/src/domain/subject/*`,
`jig/src/domain/permissions/*`, `jig/src/app/apply/apply-claude.ts`,
`jig/src/cli/{jig,apply}.ts`, live
`domains/dev/config/claude-profiles/personal/settings.personal.json`,
`spec/guard-rules.json`.

## A. Precedence

`design-v2.md` §0 states outright it replaces `design.md`: "前の担当が書いた
`design.md`（Claude Code 中心の設計）を置き換える" (design-v2.md:3). It is
explicit about *what* carries over and what doesn't: "前の担当が確認した事実
F1〜F9 は design.md §1 にあり、**そのまま引き継ぐ**。ただし **F6 は訂正する**
（下の F11）" (design-v2.md:31). So: the factual record (F1-F9, F6 corrected
by F11) survives; the *decisions* built on top of those facts (design.md's
5 pillars, decisions.md D-1改/D-2/D-7) do not survive except where
design-v2.md explicitly says it keeps them. design-v2.md was user-approved
("LGTM、進めていい", memory `harness-adapter-layer-design.md:24`) — it is the
authoritative design document. `decisions.md` is a superseded intermediate
artifact except for the parts design-v2 silently reuses (D-3 rulesync,
D-6). `requirements.md` is an empty placeholder, not a source of intent.

## B. Requirement-by-requirement table

| Requirement | Source doc:line | Status | What the code does today |
|---|---|---|---|
| Single canonical policy = `guard-rules.json` | design.md:41-44 (柱1); design-v2.md:14 problem statement | **current**, unchanged across both docs | `spec/guard-rules.json` (version 1, `floor`/`mode`/`rules`) is read by `jig/src/domain/policy/*` via `evaluatePolicy`/`judge()`. Confirmed single source for the *guard* path. |
| Projection = "choose a layer per rule" (native rules ← glob deny/allow, hook ← regex, sandbox ← fs/net) | design.md:46-58 (柱2) | **undecided / not explicitly reaffirmed or retracted**. design-v2.md §0's list of "what changes from design.md" (design-v2.md:15-27) does not mention 柱2 by name, so it isn't explicitly superseded. But design-v2.md never restates "glob-able forbid/ask rules also project to native `deny`" either — it only keeps one narrow piece: `effect: permit` → native `allow` (design-v2.md:133, "**native 権限の許可 70 件を生成するための語彙としてだけ許す**"). Forbid/ask enforcement is described as going entirely through the hook, uniformly, regardless of glob-ability (design-v2.md §3.2, §4.2 Claude Code section). | No `forbid`→native-`deny` generation exists in code. `domain/permissions/to-claude.ts::toClaudeSettings` generates `allow`/`deny`/`defaultMode` from a **different, non-guard-rules.json source**: `permissions.yaml` sidecar files (core/packs/personal), not from `guard-rules.json`. See open decision #1. |
| regex → glob 縮退 (reduction) algorithm + capability report for un-reducible rules | design.md:56, 101, 108, 120 (柱2, 柱5, §3, Phase 2) | **superseded implicitly** — the premise (native rules carry glob-degraded deny/ask) is not restated in design-v2; design-v2's core-side subject extraction (§3.2) replaces the need to degrade regex to glob for *enforcement* purposes. Not explicitly killed, just never re-affirmed. | **Not built.** `grep -rn "glob\|縮退\|reduce"` in `jig/src` finds no reduction function and no capability-report entries tied to permission projection. `apply-claude.ts`'s `TargetResult.dropped` is hardcoded to `[]` (apply-claude.ts:178, 188) — capability reporting exists generically for the *tiers* writers (`domain/tiers/capability.ts`) but is wired to nothing for permissions/guard-rules projection. |
| 柱4: delegate subcommand parsing to cc's `if: "Bash(<prog> *)"`, one hook per `program` | design.md:84-95 (柱4); decisions.md:256-274 (D-1改, "質が一番高い") | **explicitly superseded** by design-v2.md D-8: "誤爆対策をコアの主体抽出（§3.2）を採る。Claude Code の `if` への委譲は、Claude Code 専用で公式に best-effort、pi と DSH が直らないため**採らない**" (design-v2.md:287). Also design-v2.md:19, §0: "誤爆対策を Claude Code の機能に委ねない". | Confirmed by code: **no** `if:`/`Bash(<prog> *)` construct anywhere in `jig/src` (grep empty). `jig/src/domain/subject/{walk,extract,wrappers,carriers}.ts` implements the unbash-based, harness-independent strict/lenient subject-extraction walker design-v2 specifies (§3.2). The live `settings.personal.json` PreToolUse hook registration uses one **plain regex matcher** — `"Bash\|Write\|Edit\|MultiEdit\|WebFetch\|mcp__serena__(...)"` (settings.personal.json:57) — not per-program `if` entries; it invokes `jig hooks pre-tool-use --harness claude` once, and jig's own core does the subject read internally. **The own-parser approach won; it is live.** |
| 柱5: 3-stage migration (add jig hook → verify → replace native, retire yoki) | design.md:96-102 (柱5), 117-123 (§4 phases) | **superseded / reorganized**, not literally retracted but replaced by a different phase breakdown. design-v2.md §7 defines its own phases: Phase 0 (fix existing wiring) → Phase 1 (core: subject extraction + v2 schema) → Phase 2 (migrate 19 rules) → Phase 3 (four adapters incl. Claude hook registration) → Phase 4 (sandbox/JEV) → Phase 5 (live verification, retire yoki remnants). This is design-v2's own migration ladder, not design.md's 3-stage one. | Per memory: Phase 0 done (44cb5a0), Phase 1 done (subject extraction + policy v2, later collapsed to v1-numbering per "v1/v2統合"), Phase 2/3 done for pi/DSH/codex, **cc hook registration done manually** (live in settings.personal.json, user added it — jig's own `apply --target claude` still never writes). Phase 4 (sandbox one-段目) done; JEV not decided. Phase 5 (yoki retirement) not done. |
| cc への投影 (`jig apply --target claude`): generate `permissions.deny/allow` from canon + register PreToolUse hook (program-`if`) + retire yoki hook in stage 3 | design.md:104-111 (§3) | **partially superseded** (the `if`-per-program clause is dead per D-8 above); the "generate permissions.deny/allow from canon" clause is **not reaffirmed with a concrete mechanism** in design-v2 beyond permit→allow (see row 2). yoki hook retirement is still design-v2's Phase 5 (unstarted). | `jig apply --target claude` exists (`apply-claude.ts`) but is **dry-run only, `--write` is refused** (apply-claude.ts:173-182, "deferred: dry-run only this increment"). It composes a full `settings.json` (env, hooks, MCP, permissions.allow/deny) from **yoki-style layers** (`.claude-packs`, `settings.layer.json`, `permissions.yaml`, `mcp.json` under core/packs/personal) — see open decision #1, this is not what either design doc describes as the projection source. |
| Absolute/floor rules cannot be disabled by any config | design-v2.md §3.3 (D-19/floor), design-v2.md:167-173 | **current** | `guard-rules.json`'s top-level `floor` array (19 entries per memory) is evaluated first in `evaluatePolicy`/`judge()`, ahead of `mode`/`rules`. Confirmed live (floor-policy-write/edit/redirect entries visible in guard-rules.json:8-30). |
| fs.write/fs.edit floor+forbid+ask rule set (D-20) | design-v2.md §5.2 (D-20), design-v2.md:273-283 | **current, live** | Per memory, reflected in guard-rules.json (`floor` 19 / `rules` 29, shell-rc floor, home-secret forbid, repo-secret/CI ask). Matches D-20's spec. |
| fs.read: no guard rule, sandbox-only | design-v2.md:279 | **current** | No fs.read rules in guard-rules.json (not inspected exhaustively, but design explicitly says none should exist and none were mentioned in memory's "floor 19・rules 29" tally). |
| net.fetch: no guard rule for interactive default, allowlist lives in sandbox layer | design-v2.md:281 | **current** | Not implemented as a guard rule (by design); sandbox-layer allowlist (sbx kit `permissions.network.allow`) is Phase 4/二段目, done per pi per memory. |
| Hook registration (per-adapter, not per-program) | design-v2.md §4.2 (Claude Code subsection), design-v2.md:225 | **current** | Live: single PreToolUse entry in `settings.personal.json` invoking `jig hooks pre-tool-use --harness claude`, matcher is the plain-regex tool-name list, not per-program. Matches design-v2 intent (`if` used only as "a cheap pre-filter, never the basis for the decision" — design-v2.md:165 — and in practice not even used as a pre-filter today). |
| MCP projection | design.md:130 ("later phase"); design-v2.md §7 ("別タスクに残すもの: MCP のルールの詳細") | **explicitly deferred by both docs**, still deferred | `domain/mcp/to-claude.ts::buildClaudeMcpServers` exists and IS wired into `apply-claude.ts` (line 152) — but it projects from the **yoki-style `mcp.json` layers**, not from `guard-rules.json`'s `mcp.call` action (which design-v2.md:283 says is "未調査で開いたまま" for guard purposes). Two unrelated "MCP" concerns exist: (a) which MCP servers are *configured* (mcp.json → apply-claude.ts, unrelated to guard-rules.json) and (b) whether MCP *calls* are guarded (mcp.call, unbuilt). Neither doc reconciles that apply-claude.ts already does (a). |
| skills/agents/commands projection | design.md:130; design-v2.md §7 "別タスクに残す" | **explicitly deferred by both docs** | Not built for Claude target. |
| env / defaultMode projection | not named as in-scope or deferred by either design doc specifically | **undecided (silently in-scope via code, never discussed in design docs)** | `apply-claude.ts` projects `env`, `defaultMode` (via `toClaudeSettings`), `enabledPlugins`, `extraKnownMarketplaces`, non-guard hooks (SessionStart/PostToolUse/Notification/UserPromptSubmit) — all sourced from yoki-style layer composition, none of which either design.md or design-v2.md discusses. This is scope the code has quietly taken on that the two design docs never addressed at all (they only ever discuss the guard/permission projection, not full settings.json composition). |

## C. Does any current doc sanction `permissions.yaml`/`settings.layer.json`/`mcp.json`/packs as a projection source?

**No.** `grep -n "permissions.yaml\|settings.layer.json\|mcp.json\|\.claude-packs\|pack enable\|pack disable\|packs" design.md design-v2.md decisions.md requirements.md` returns **zero matches** in all four files. Neither design doc mentions these files or a packs enable/disable model at all — design.md and design-v2.md both frame the *only* canonical source as `guard-rules.json` (design.md F1, design-v2.md problem statement). The `permissions.yaml`/`settings.layer.json`/`mcp.json`/`.claude-packs` pipeline that `apply-claude.ts` actually reads from is a **separate, undocumented-in-spec effort** — it's driven by `.tmp-research/install-pipeline-plan.md` (a working note, not a spec doc, opening line: "Builds directly on `.tmp-research/yoki-jig-coverage.md` §2"), which is about reproducing `yoki-switch`'s *whole-settings.json compose* (env/plugins/MCP/native-permissions-from-permissions.yaml), not about projecting `guard-rules.json`. This is effectively the exact yoki-parity "packs" model the user suspected is unsanctioned by current guard-projection design intent — confirmed.

## D. Beyond permissions.deny/allow — what must projection produce?

- **Hook registration**: in scope, current, done for Claude (single PreToolUse entry, `--harness claude`).
- **MCP projection**: explicitly deferred by both docs *for guard/mcp.call purposes*; but a same-named, unrelated MCP-servers-list projection (from `mcp.json`, not `guard-rules.json`) is already built and wired in `apply-claude.ts` — scope not reconciled with either doc.
- **env, defaultMode**: `defaultMode` is explicitly named in design.md's `ClaudePermissionsSettings` shape (design.md's own code snippets don't show this, but `domain/permissions/to-claude.ts:16` includes `defaultMode`); neither design doc discusses `env` projection at all — it's out-of-band, yoki-parity-sourced, undiscussed.
- **skills/agents/commands**: explicitly deferred by both docs.

## E. regex → glob reduction: spec vs code

Neither `design.md` nor `design-v2.md` specifies an *algorithm* for regex→glob reduction — design.md only asserts it should happen and that un-reducible rules go to a capability report (design.md:56, 108); design-v2.md never revisits the mechanism at all (the native-rules role shrank to permit→allow only, see row 2 of §B). No code implements a reduction function (`grep -rn "glob\|縮退\|reduce"` in `jig/src` — the only hits are unrelated: `Array.reduce`, `argv.reduce`, comments). **Unbuilt, and the current design doesn't even call for it in the form design.md originally specified** — this is a live open question, not just an implementation gap.

## Open decisions the projection redesign must get from the owner

1. **Two competing sources for Claude's `permissions.allow`/`deny`**: `apply-claude.ts` (uncommitted, in progress) builds them from `permissions.yaml` layers (core/packs/personal, yoki-ported), while design-v2.md's `effect: permit` clause (§3.1) implies `guard-rules.json` should be the generator, at least for `allow`. Neither doc reconciles these. Does `permissions.yaml` get retired in favor of `guard-rules.json`-derived native permissions, does it stay as a second, parallel native-permissions source, or does `guard-rules.json`'s `permit` effect get dropped in favor of `permissions.yaml`?
2. **Does a glob-able forbid/ask rule still also project to native `deny`/`ask`** (design.md's 柱2 rationale: survives `bypassPermissions`, no process spawn, lockable via managed settings) now that the hook does uniform core-side subject extraction regardless of glob-ability? design-v2 never says yes or no.
3. **Is regex→glob reduction (and its capability report) still required at all**, given design-v2's shift to core subject extraction for enforcement? If yes, the algorithm and capability-report shape still need to be specified — nothing exists today.
4. **Should `jig apply --target claude` ever get a `--write` path**, and if so, does it write the guard-hook registration too (currently hand-added by the user into `settings.personal.json`, not generated), or does that stay permanently hand-maintained per design-v2's Phase 3 note that the hook registration is "individually confirmed" (design-v2.md:315, "個別に確認してから行う")?
5. **Scope of `apply-claude.ts`'s existing env/plugins/MCP-servers/non-guard-hooks composition** relative to task 001's design docs, which never discuss this — is this in-scope for task 001 at all, or is it a different, unscoped effort that happens to share the `apply --target claude` CLI surface?
6. **`requirements.md` is still an empty placeholder** ("未記入 — `/sdd clarify` で grilling により確定する") — no requirements have ever been formally captured for this task, only design docs and decision records.

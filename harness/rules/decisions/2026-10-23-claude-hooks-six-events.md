# Claude Code のフックは六つの出来事に一本ずつにする

Status: accepted — 持ち主の裁定（2026-10-23）。2026-09-22-hooks-five-events.md を置き換える（SubagentStop を足すほかは、五本の役目と、捨てたフックの理由を引き継ぐ）

rule: Register exactly one hook per event, six total in Claude Code: PreToolUse (jig guard), SessionStart (session model record), UserPromptSubmit (skill selection, and the record of a typed `/skill`), PostToolUse (silent format of edited files, and the record of a `Skill` call and of a `SubagentHandback` report), SubagentStop (the record of a finished subagent and its `Findings` line), Stop (type-check/lint gate and the findings-verification check). Do not add separate hooks for auditing, budgets, fixed context injection, or output compression — use native harness features instead.
scope: repo

## Problem

2026-10-23-findings-verification-check.md で、reviewer が指摘を報告したら検証役が走ったかを Stop で確かめることにした。subagent が終わったことと、その報告の本文を知れる出来事は、auto mode 以外では SubagentStop だけで、五本のどれにも届かない。

## Decision

- 五本（PreToolUse、SessionStart、UserPromptSubmit、PostToolUse、Stop）はそのまま残し、SubagentStop を足して六本にする。
- SubagentStop の hook は記録するだけで、出力を返さない。subagent を止めたり続けさせたりしない。
- PostToolUse の matcher に `Skill` と `SubagentHandback` を足し、使った skill と、auto mode で渡された報告の記録も持たせる。整形の仕事は変えない。
- 監査、予算、固定の文脈の注入、出力の圧縮のための hook を足さない理由は、2026-09-22-hooks-five-events.md のとおり。

## Alternatives considered

- **Agent ツールの PostToolUse で代える**: 背景で起動した subagent は、起動した時点で PostToolUse が返るので、終わったことも報告の本文も分からない（2026-10-23 の実機の確認）。却下。
- **subagent の transcript のファイルを Stop で読む**: Claude Code の内部のファイルの形に依存する。出来事に載っている `agent_type` と報告の本文で足りる。却下。

## Consequences

- `jig/src/domain/claude/hooks.ts` の一覧が六本になる。Codex、omp、pi、DSH の hook の数は変わらない。

## Sources

- 2026-09-22-hooks-five-events.md、2026-10-23-findings-verification-check.md
- SubagentStop と `SubagentHandback` の入力: https://code.claude.com/docs/en/hooks

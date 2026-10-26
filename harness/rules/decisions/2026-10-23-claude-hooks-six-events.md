# Claude Codeのフックは六つの出来事に一本ずつにする

Status: accepted — 持ち主の裁定（2026-10-23）。2026-09-22-hooks-five-events.mdを置き換える（SubagentStopを足すほかは、五本の役目と、捨てたフックの理由を引き継ぐ）

rule: Register exactly one hook per event, six total in Claude Code: PreToolUse (jig guard), SessionStart (session model record), UserPromptSubmit (skill selection, and the record of a typed `/skill`), PostToolUse (silent format of edited files, and the record of a `Skill` call and of a `SubagentHandback` report), SubagentStop (the record of a finished subagent and its `Findings` line), Stop (type-check/lint gate and the findings-verification check). Do not add separate hooks for auditing, budgets, fixed context injection, or output compression — use native harness features instead.
scope: repo

## Problem

2026-10-23-findings-verification-check.mdで、reviewerが指摘を報告したら検証役が走ったかをStopで確かめることにした。subagentが終わったことと、その報告の本文を知れる出来事は、auto mode以外ではSubagentStopだけで、五本のどれにも届かない。

## Decision

- 五本（PreToolUse、SessionStart、UserPromptSubmit、PostToolUse、Stop）はそのまま残し、SubagentStopを足して六本にする。
- SubagentStopのhookは記録するだけで、出力を返さない。subagentを止めたり続けさせたりしない。
- PostToolUseのmatcherに`Skill`と`SubagentHandback`を足し、使ったskillと、auto modeで渡された報告の記録も持たせる。整形の仕事は変えない。
- 監査、予算、固定の文脈の注入、出力の圧縮のためのhookを足さない理由は、2026-09-22-hooks-five-events.mdのとおり。

## Alternatives considered

- **AgentツールのPostToolUseで代える**: 背景で起動したsubagentは、起動した時点でPostToolUseが返るので、終わったことも報告の本文も分からない（2026-10-23の実機の確認）。却下。
- **subagentのtranscriptのファイルをStopで読む**: Claude Codeの内部のファイルの形に依存する。出来事に載っている`agent_type`と報告の本文で足りる。却下。

## Consequences

- `jig/src/domain/claude/hooks.ts`の一覧が六本になる。Codex、omp、pi、DSHのhookの数は変わらない。

## Sources

- 2026-09-22-hooks-five-events.md、2026-10-23-findings-verification-check.md
- SubagentStopと`SubagentHandback`の入力: https://code.claude.com/docs/en/hooks

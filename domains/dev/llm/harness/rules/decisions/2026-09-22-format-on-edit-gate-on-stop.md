# 整形は編集ごとに無音で、型検査と lint は応答の終わりで関門にする

Status: accepted — 公開リポジトリの主流と各ハーネスの仕組みに合い、編集ごとの整形は文脈を消費しない（2026-09-22）

rule: Format edited files silently on every edit (PostToolUse in Claude Code, tool_result in pi, tools/post-execute in DSH), never at Stop/session-end. Gate type-checking and lint at the response's end (Stop in Claude Code, agent_before_settle in pi, agent/turn-stopping in DSH with a self-imposed retry cap); Codex runs the formatter once via an AGENTS.md instruction.

## Problem

エージェントが編集したファイルの整形、lint、型検査を、編集ごとのフックで走らせるか、応答の終わり(Stop)でまとめるか、エージェントの外(pre-commit、CI、指示)に置くか、LSP の診断に任せるか。編集ごとの整形で「整形後のファイルを読み直して混乱する往復」が起きたという記録があり、Stop にまとめる案が浮上していた。

## Decision

- Claude Code: 整形は編集ごと(PostToolUse)、編集したファイルだけ、無音(exit 0)。型検査と lint は Stop の関門で、`stop_hook_active` を見て二度目は止め、出力は末尾だけに切り詰める。型の言語では LSP plugin の診断を編集ごとに受け、Stop の `tsc` はその後ろ盾。
- pi: `tool_result` で編集ごとに整形。関門は `agent_before_settle`(0.87.0 で追加。`{ continue: true }` で次のリクエストを一回強制できる。`agent_settled` は強制できない)で、回数の上限を自前で持つ。
- DSH: `tools/post-execute` で編集ごとに整形。`agent/turn-stopping` の関門は連続ブロックの上限がないので、必ず自前で止める。
- Codex: 指示(AGENTS.md)で「変更を終えたら formatter を一度、その後テストを再実行しない」。

## Alternatives considered

- **整形も Stop でまとめる**: 一件の記録(marmelab)は Stop の check モードに移ったが、その後モデルがフックの仕事を自分でも走らせて Bash 呼び出しの 6〜7 割が無駄になり、Stop が一時停止ごとに発火して 60〜150 秒増え、最終的に「引き渡し直前に一度、内容ハッシュで飛ばす」形へ移った。Stop は質問への回答でも発火する。整形を Stop に置く例は公開リポジトリでは少数。却下。
- **エージェントの外(pre-commit、CI)だけ**: pre-commit の整形も Claude Code の mtime 検査を踏む(issue #65575)。エージェントが `--no-verify` で迂回する事例が多く、それを止める PreToolUse フックが 1,640 件ある。無人のときの決定的な関門にならない。単独では却下、Stop の関門の後ろ盾としては可。
- **LSP の診断だけ**: 公式の LSP plugin は型と構文の診断だけで、eslint や ruff に相当する plugin はない。診断が編集の後に届かず次のターンに落ちる(#93321)、整形フックの後に整形前の行番号を報告する(#80267、保守者が確認、未修正)、hint の洪水(#95507)。単独では却下、併用は可。
- **編集ごとに tsc を走らせる**: 誰も勧めておらず、利得の証拠がない。却下。

## Consequences

- Claude Code の編集ごとの整形は、mtime の変更で次の Edit が失敗する既知の問題(#3513、2025-07 から未解決)を持つ。2.1.90 で同一ターン内は修正され、起きても読み直し一回で済む。フックは編集したファイルだけを整形し(ツリー全体を整形しない)、無音にする。
- Stop の関門は空回りすると高い(35k トークン・20 分の記録)。Claude Code は 8 回で強制終了、Cursor は 5 回、DSH は上限なし、pi も自前。
- 四案を統制して比べた測定はどこにもない。この判断は仕組みの読解と公開リポジトリの実態に基づく。

## Sources

- `rules/research/2026-09-22-format-hook-timing.md`
- Claude Code hooks 手引き: https://code.claude.com/docs/en/hooks-guide 、hooks 仕様: https://code.claude.com/docs/en/hooks
- mtime の失敗: https://github.com/anthropics/claude-code/issues/3513 、LSP の行番号: https://github.com/anthropics/claude-code/issues/80267
- marmelab の変更履歴: https://github.com/marmelab/crm-builder/blob/main/CHANGELOG.md
- streamlit の併用例: https://github.com/streamlit/streamlit/blob/develop/.claude/settings.json
- Codex の AGENTS.md: https://raw.githubusercontent.com/openai/codex/main/AGENTS.md 、OpenCode の LSP 見解: https://opencode.ai/docs/lsp/

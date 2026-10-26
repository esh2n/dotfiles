# 整形は編集ごとに無音で、型検査とlintは応答の終わりで関門にする

Status: accepted — 公開リポジトリの主流と各ハーネスの仕組みに合い、編集ごとの整形は文脈を消費しない（2026-09-22）

rule: Format edited files silently on every edit (PostToolUse in Claude Code, tool_result in pi, tools/post-execute in DSH), never at Stop/session-end. Gate type-checking and lint at the response's end (Stop in Claude Code, agent_before_settle in pi, agent/turn-stopping in DSH with a self-imposed retry cap); Codex runs the formatter once via an AGENTS.md instruction.
scope: repo

## Problem

エージェントが編集したファイルの整形、lint、型検査を、編集ごとのフックで走らせるか、応答の終わり(Stop)でまとめるか、エージェントの外(pre-commit、CI、指示)に置くか、LSPの診断に任せるか。編集ごとの整形で「整形後のファイルを読み直して混乱する往復」が起きたという記録があり、Stopにまとめる案が浮上していた。

## Decision

- Claude Code: 整形は編集ごと(PostToolUse)、編集したファイルだけ、無音(exit 0)。型検査とlintはStopの関門で、`stop_hook_active`を見て二度目は止め、出力は末尾だけに切り詰める。型の言語ではLSP pluginの診断を編集ごとに受け、Stopの`tsc`はその後ろ盾。
- pi: `tool_result`で編集ごとに整形。関門は`agent_before_settle`(0.87.0で追加。`{ continue: true }`で次のリクエストを一回強制できる。`agent_settled`は強制できない)で、回数の上限を自前で持つ。
- DSH: `tools/post-execute`で編集ごとに整形。`agent/turn-stopping`の関門は連続ブロックの上限がないので、必ず自前で止める。
- Codex: 指示(AGENTS.md)で「変更を終えたらformatterを一度、その後テストを再実行しない」。

## Alternatives considered

- **整形もStopでまとめる**: 一件の記録(marmelab)はStopのcheckモードに移ったが、その後モデルがフックの仕事を自分でも走らせてBash呼び出しの6〜7割が無駄になり、Stopが一時停止ごとに発火して60〜150秒増え、最終的に「引き渡し直前に一度、内容ハッシュで飛ばす」形へ移った。Stopは質問への回答でも発火する。整形をStopに置く例は公開リポジトリでは少数。却下。
- **エージェントの外(pre-commit、CI)だけ**: pre-commitの整形もClaude Codeのmtime検査を踏む(issue #65575)。エージェントが`--no-verify`で迂回する事例が多く、それを止めるPreToolUseフックが1,640件ある。無人のときの決定的な関門にならない。単独では却下、Stopの関門の後ろ盾としては可。
- **LSPの診断だけ**: 公式のLSP pluginは型と構文の診断だけで、eslintやruffに相当するpluginはない。診断が編集の後に届かず次のターンに落ちる(#93321)、整形フックの後に整形前の行番号を報告する(#80267、保守者が確認、未修正)、hintの洪水(#95507)。単独では却下、併用は可。
- **編集ごとにtscを走らせる**: 誰も勧めておらず、利得の証拠がない。却下。

## Consequences

- Claude Codeの編集ごとの整形は、mtimeの変更で次のEditが失敗する既知の問題(#3513、2025-07から未解決)を持つ。2.1.90で同一ターン内は修正され、起きても読み直し一回で済む。フックは編集したファイルだけを整形し(ツリー全体を整形しない)、無音にする。
- Stopの関門は空回りすると高い(35kトークン・20分の記録)。Claude Codeは8回で強制終了、Cursorは5回、DSHは上限なし、piも自前。
- 四案を統制して比べた測定はどこにもない。この判断は仕組みの読解と公開リポジトリの実態に基づく。

## Sources

- pre-commit側のstaleness事故: https://github.com/anthropics/claude-code/issues/65575
- LSP診断が届かない: https://github.com/anthropics/claude-code/issues/93321 、hintの洪水: https://github.com/anthropics/claude-code/issues/95507
- Claude Code hooks手引き: https://code.claude.com/docs/en/hooks-guide 、hooks仕様: https://code.claude.com/docs/en/hooks
- mtimeの失敗: https://github.com/anthropics/claude-code/issues/3513 、LSPの行番号: https://github.com/anthropics/claude-code/issues/80267
- marmelabの変更履歴: https://github.com/marmelab/crm-builder/blob/main/CHANGELOG.md
- streamlitの併用例: https://github.com/streamlit/streamlit/blob/develop/.claude/settings.json
- CodexのAGENTS.md: https://raw.githubusercontent.com/openai/codex/main/AGENTS.md 、OpenCodeのLSP見解: https://opencode.ai/docs/lsp/

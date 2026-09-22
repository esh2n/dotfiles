# フックは五つの出来事に一本ずつ、監査と予算はハーネス標準に任せ、出力の圧縮は公式の形で自作する

Status: accepted — 監査と予算はベンダー標準が手製より上位互換、固定の注入は事故の記録があり効果の測定が無い、圧縮は公式が推奨する形だけが安全（2026-09-22）

## Problem

整形以外に 11 本のフック（git-guard、audit-log、mcp-audit、skill-router、unattended-guard、workflow-guard、worktree-hygiene、project-hint、rtk-rewrite、english-coach、tmux-sidebar、herdr-agent-state）が Claude Code に登録されている。整形の時期は別の決定で裁定済み（`2026-09-22-format-on-edit-gate-on-stop.md`）だが、それ以外の分類（ガード、監査、注入、圧縮、予算）は裁定が無かった。

## Decision

フックは出来事ごとに一本、五本に畳む。

- PreToolUse: jig のガード（`guard-rules.json` の判断）。
- SessionStart: セッションのモデル記録（`jig hooks session-start`）。
- UserPromptSubmit: スキル選択（jig の判断サービスが毎ターン選ぶ。`jig report skills` で「注入したもの対実際に開いたもの」を測る）。
- PostToolUse: 編集したファイルだけの無音の整形。
- Stop: 型検査と lint の関門。

捨てるもの: git-guard（jig のガードが同じ判断をプログラム単位の分解で行う）、audit-log と mcp-audit（jig の監査 jsonl と OpenTelemetry）、unattended-guard と workflow-guard（無人時の制約はガードのルール、予算は `--max-budget-usd`）、worktree-hygiene と project-hint（固定の文脈は AGENTS.md へ、packs は廃止）、english-coach（固定注入。要るなら常時ルールか呼ぶスキル）、rtk-rewrite。

jig が所有しないもの: tmux-sidebar（既定で無効）、herdr-agent-state（herdr の installer の仕事）。

後で足す唯一の候補: テスト実行と長いログの出力を失敗行だけに絞る PreToolUse フック。Claude Code の費用文書の例と同じ形で、対象を絞り、監査で実測してから広げる。

## Alternatives considered

- **手製の監査ログを残す**: 公開リポジトリに約 1,600 件あるが、見つかった例（awslabs/aidlc-workflows、ben-manes/caffeine ほか）は全部平文の追記。Claude Code の OpenTelemetry は `tool_result`（tool 名、成否、所要時間）と `tool_decision`（判断の出どころが config/hook/user/auto のどれか）を構造化して出し、`OTEL_LOG_TOOL_DETAILS=1` でコマンド本文まで載る。手製は下位互換。却下。
- **フック型の予算ガード**: `--max-budget-usd` がネイティブにあり、フックの `deny` は `bypassPermissions` でも `--dangerously-skip-permissions` でも無効化できない（「Hooks can tighten restrictions but not loosen them」）。フック型の予算ガードは公開リポジトリで見つからず、第三者製品（markus）は UI 文言でネイティブの flag を上限として案内している。却下。
- **rtk を入れる**: 分類（コマンド出力の圧縮）は Claude Code 公式が推奨し、`PreToolUse` でテスト出力を `grep -E 'FAIL|ERROR'` で絞る完成例が費用文書にある。会話の compaction は履歴の要約で、コマンド単位の削減とは別の層なので重複しない。しかし rtk 本体（star 81,356、open issue 1,555、8 か月）は今週の未解決だけで、パイプ付きコマンドは書き換え自体が無効（#4189）、`git diff/status` がディスクに無い文字列を出力（#4183）、`pytest --collect-only` を 0 件と誤報告（#4178）、節約率の誤表示（#4158）。作者自身が「90% の出力削減は 90% の費用削減ではない」「トークン数は bytes/4 の概算」と明記。モデルが見る出力に嘘が混じる道具は節約と引き換えにできない。却下。公式例の形を自作する。
- **SessionStart と UserPromptSubmit で固定の文脈を注入し続ける**: 公式ガイドは SessionStart を「compaction 後の再注入」と「direnv」に限り、「毎セッション固定の文脈は CLAUDE.md に」と明言。UserPromptSubmit の公式例は毎ターン変わる事実（「Current branch: release-42. Deploy freeze until Friday」）。効果の測定は業界のどこにも無い。事故: #60112（SessionStart フックが背景セッションを全部落とす）、#64223（UserPromptSubmit の失敗で入力が止まる）、#84011（注入がプロンプトキャッシュを毎ターン壊し、費用が上がる）。動的なもの（スキル選択、モデル記録）だけ残す。

## Consequences

- Claude Code の `hooks` は 7 出来事 33 本から 5 出来事 5 本になる。Codex は `hooks.json` に同じ五本（Stop 相当は Codex に無いので AGENTS.md の指示）、pi と DSH はコードで同等を持つ（`2026-09-22-format-on-edit-gate-on-stop.md`）。
- 監査は jig の jsonl（判断ごと、モデル付き）が一次、OpenTelemetry の定額の盤面は保留の調査。
- 圧縮フックは「対象を絞る」「失敗行だけ通す」「実測してから広げる」を守る。全コマンドの書き換えはしない。
- 前例なし: 五本構成での効果の測定は誰も出していない。Codex・pi・omp・DSH のネイティブの監査・予算相当は未調査。

## Sources

- `rules/research/2026-09-22-hooks-beyond-formatting.md`
- Claude Code の監視: https://code.claude.com/docs/en/monitoring-usage.md 、費用: https://code.claude.com/docs/en/costs.md 、フックの手引き: https://code.claude.com/docs/en/hooks-guide.md
- rtk: https://github.com/rtk-ai/rtk 、https://github.com/rtk-ai/rtk/blob/develop/docs/guide/resources/savings-explained.md
- Claude Code の issue: https://github.com/anthropics/claude-code/issues/84011 、/64223 、/60112
- 公開リポジトリの監査フック例: https://github.com/awslabs/aidlc-workflows 、https://github.com/ben-manes/caffeine

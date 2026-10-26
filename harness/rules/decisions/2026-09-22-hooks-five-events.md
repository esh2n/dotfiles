# フックは五つの出来事に一本ずつ、監査と予算はハーネス標準に任せ、出力の圧縮は公式の形で自作する

Status: superseded — 2026-10-23-claude-hooks-six-events.mdが置き換える（SubagentStopを足して六本にする。五本の役目と捨てたフックの理由は引き継ぐ）。もとの裁定は2026-09-22（監査と予算はベンダー標準が手製より上位互換、固定の注入は事故の記録があり効果の測定が無い、圧縮は公式が推奨する形だけが安全）

rule: Register exactly one hook per event, five total: PreToolUse (jig guard), SessionStart (session model record), UserPromptSubmit (skill selection), PostToolUse (silent format of edited files), Stop (type-check/lint gate). Do not add separate hooks for auditing, budgets, fixed context injection, or output compression — use native harness features instead.
scope: repo

## Problem

整形以外に11本のフック（git-guard、audit-log、mcp-audit、skill-router、unattended-guard、workflow-guard、worktree-hygiene、project-hint、rtk-rewrite、english-coach、tmux-sidebar、herdr-agent-state）がClaude Codeに登録されている。整形の時期は別の決定で裁定済み（`2026-09-22-format-on-edit-gate-on-stop.md`）だが、それ以外の分類（ガード、監査、注入、圧縮、予算）は裁定が無かった。

## Decision

フックは出来事ごとに一本、五本に畳む。

- PreToolUse: jigのガード（`guard-rules.json`の判断）。
- SessionStart: セッションのモデル記録（`jig hooks session-start`）。
- UserPromptSubmit: スキル選択（jigの判断サービスが毎ターン選ぶ。`jig report skills`で「注入したもの対実際に開いたもの」を測る）。
- PostToolUse: 編集したファイルだけの無音の整形。
- Stop: 型検査とlintの関門。

捨てるもの: git-guard（jigのガードが同じ判断をプログラム単位の分解で行う）、audit-logとmcp-audit（jigの監査jsonlとOpenTelemetry）、unattended-guardとworkflow-guard（無人時の制約はガードのルール、予算は`--max-budget-usd`）、worktree-hygieneとproject-hint（固定の文脈はAGENTS.mdへ、packsは廃止）、english-coach（固定注入。要るなら常時ルールか呼ぶスキル）、rtk-rewrite。

jigが所有しないもの: tmux-sidebar（既定で無効）、herdr-agent-state（herdrのinstallerの仕事）。

後で足す唯一の候補: テスト実行と長いログの出力を失敗行だけに絞るPreToolUseフック。Claude Codeの費用文書の例と同じ形で、対象を絞り、監査で実測してから広げる。

## Alternatives considered

- **手製の監査ログを残す**: 公開リポジトリに約1,600件あるが、見つかった例（awslabs/aidlc-workflows、ben-manes/caffeineほか）は全部平文の追記。Claude CodeのOpenTelemetryは`tool_result`（tool名、成否、所要時間）と`tool_decision`（判断の出どころがconfig/hook/user/autoのどれか）を構造化して出し、`OTEL_LOG_TOOL_DETAILS=1`でコマンド本文まで載る。手製は下位互換。却下。
- **フック型の予算ガード**: `--max-budget-usd`がネイティブにあり、フックの`deny`は`bypassPermissions`でも`--dangerously-skip-permissions`でも無効化できない（「Hooks can tighten restrictions but not loosen them」）。フック型の予算ガードは公開リポジトリで見つからず、第三者製品（markus）はUI文言でネイティブのflagを上限として案内している。却下。
- **rtkを入れる**: 分類（コマンド出力の圧縮）はClaude Code公式が推奨し、`PreToolUse`でテスト出力を`grep -E 'FAIL|ERROR'`で絞る完成例が費用文書にある。会話のcompactionは履歴の要約で、コマンド単位の削減とは別の層なので重複しない。しかしrtk本体（star 81,356、open issue 1,555、8か月）は今週の未解決だけで、パイプ付きコマンドは書き換え自体が無効（#4189）、`git diff/status`がディスクに無い文字列を出力（#4183）、`pytest --collect-only`を0件と誤報告（#4178）、節約率の誤表示（#4158）。作者自身が「90% の出力削減は90% の費用削減ではない」「トークン数はbytes/4の概算」と明記。モデルが見る出力に嘘が混じる道具は節約と引き換えにできない。却下。公式例の形を自作する。
- **SessionStartとUserPromptSubmitで固定の文脈を注入し続ける**: 公式ガイドはSessionStartを「compaction後の再注入」と「direnv」に限り、「毎セッション固定の文脈はCLAUDE.mdに」と明言。UserPromptSubmitの公式例は毎ターン変わる事実（「Current branch: release-42. Deploy freeze until Friday」）。効果の測定は業界のどこにも無い。事故: #60112（SessionStartフックが背景セッションを全部落とす）、#64223（UserPromptSubmitの失敗で入力が止まる）、#84011（注入がプロンプトキャッシュを毎ターン壊し、費用が上がる）。動的なもの（スキル選択、モデル記録）だけ残す。

## Consequences

- Claude Codeの`hooks`は7出来事33本から5出来事5本になる。Codexは`hooks.json`に同じ五本（Stop相当はCodexに無いのでAGENTS.mdの指示）、piとDSHはコードで同等を持つ（`2026-09-22-format-on-edit-gate-on-stop.md`）。
- 監査はjigのjsonl（判断ごと、モデル付き）が一次、OpenTelemetryの定額の盤面は保留の調査。
- 圧縮フックは「対象を絞る」「失敗行だけ通す」「実測してから広げる」を守る。全コマンドの書き換えはしない。
- 前例なし: 五本構成での効果の測定は誰も出していない。Codex・pi・omp・DSHのネイティブの監査・予算相当は未調査。

## Sources

- rtkの未解決の不具合（#4189/#4183/#4178/#4158として本文で参照）: https://github.com/rtk-ai/rtk/issues/4189 、https://github.com/rtk-ai/rtk/issues/4183 、https://github.com/rtk-ai/rtk/issues/4178 、https://github.com/rtk-ai/rtk/issues/4158
- Claude Codeの監視: https://code.claude.com/docs/en/monitoring-usage.md 、費用: https://code.claude.com/docs/en/costs.md 、フックの手引き: https://code.claude.com/docs/en/hooks-guide.md
- rtk: https://github.com/rtk-ai/rtk 、https://github.com/rtk-ai/rtk/blob/develop/docs/guide/resources/savings-explained.md
- Claude Codeのissue: https://github.com/anthropics/claude-code/issues/84011 、/64223 、/60112
- 公開リポジトリの監査フック例: https://github.com/awslabs/aidlc-workflows 、https://github.com/ben-manes/caffeine

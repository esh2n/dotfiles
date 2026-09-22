# skill は外から二本入れ、重複を捨て、資産を skill の外に出す

Status: accepted — 確認された穴を埋める二本だけ入れ、三重の一本を捨て、成果物置き場になっていた skill を手順だけに戻す（2026-09-22）

## Problem

88 本の skill のうち、外から入れる価値がある物はあるか。重複している物、skill の中に大きな資産（動画、バイナリ、ビルド成果物）を抱えている物をどうするか。

なお「休眠している 34 本をどう扱うか（一覧に載せるか、載せずに判断サービスが選ぶか）」は**この決定に含めない**。判断サービス（jev）による選択の追従率が実測で 6%（注入 210 回、従われた 12 回）で、設計どおりに動いているかの確認と、業界がどう選んでいるかの調査が先。結果が出てから別の決定メモにする。

## Decision

- **外から二本入れる**: obra/superpowers の `using-git-worktrees`（作業を worktree で隔離する。「main のチェックアウトを他のエージェントがブランチ切替する」事故に対応）と `verification-before-completion`（完了を言う前に検証コマンドの出力を確認する）。どちらも今の 88 本に無い役割。導入前に全文を読む（公式 plugin リポジトリでさえ第三者スキャナが critical 3 件・high 11 件を出した）。
- **`writing-skills` は捨てる。** Codex 同梱の Skill Creator、Anthropic の `skill-creator`（導入済み）と三重。
- **skill の中の資産は外に出す。** `yoki-artifact` の 230MB（Worker のビルド成果物）、`dopa-shorts` の 345MB（動画）、`writeup-kit` の 23MB（バイナリ）、`grilling` の 9.2MB。skill は手順で、成果物置き場ではない。

## Alternatives considered

- **他の候補（brainstorming、finishing-a-development-branch、subagent-driven-development）も入れる**: 「ある方がよさそう」止まりで、確認された穴が無い。入れない。
- **文書処理（docx/pdf/pptx/xlsx）や skill 作成の skill を自作する**: Anthropic の skills が同梱し導入済み。却下。
- **資産を skill に置いたままにする**: 約 600MB が symlink 経由で各ハーネスの skill 置き場に見え、複製や配布のたびに付いて回る。却下。

## Consequences

- obra の二本は全文を読んでから `skills/` に置く。出所と pinned commit を記す（`natural-japanese/UPSTREAM.md` と同じ形）。
- 資産の移し先は skill と同じリポジトリの外か、`domains/` の別の場所。skill からは相対パスで参照しない。
- 「本数が精度を下げる」数字は無い（Anthropic の「Too many tools or overlapping tools can also distract agents」は定性）。測れているのは追従率だけ。

## Sources

- `.tmp-research/skills-inventory-and-market.md`
- obra/superpowers: https://github.com/obra/superpowers 、公式 plugin のスキャン結果: https://github.com/anthropics/claude-plugins-official/issues/5704
- Anthropic: https://www.anthropic.com/engineering/writing-tools-for-agents 、Claude Code: https://code.claude.com/docs/en/skills.md

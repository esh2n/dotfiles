# skillは外から二本入れ、重複を捨て、資産をskillの外に出す

Status: accepted — 確認された穴を埋める二本だけ入れ、三重の一本を捨て、成果物置き場になっていたskillを手順だけに戻す（2026-09-22）

rule: Add only obra/superpowers's using-git-worktrees and verification-before-completion skills after reading them in full and recording upstream + pinned commit; drop writing-skills as a duplicate of skill-creator. Move large binary/video assets (e.g. yoki-artifact, dopa-shorts, writeup-kit, grilling) out of skills — a skill holds procedure, never build artifacts or media.
scope: repo

## Problem

88本のskillのうち、外から入れる価値がある物はあるか。重複している物、skillの中に大きな資産（動画、バイナリ、ビルド成果物）を抱えている物をどうするか。

なお「休眠している34本をどう扱うか（一覧に載せるか、載せずに判断サービスが選ぶか）」は**この決定に含めない**。判断サービス（jev）による選択の追従率が実測で6%（注入210回、従われた12回）で、設計どおりに動いているかの確認と、業界がどう選んでいるかの調査が先。結果が出てから別の決定メモにする。

## Decision

- **外から二本入れる**: obra/superpowersの`using-git-worktrees`（作業をworktreeで隔離する。「mainのチェックアウトを他のエージェントがブランチ切替する」事故に対応）と`verification-before-completion`（完了を言う前に検証コマンドの出力を確認する）。どちらも今の88本に無い役割。導入前に全文を読む（公式pluginリポジトリでさえ第三者スキャナがcritical 3件・high 11件を出した）。
- **`writing-skills`は捨てる。** Codex同梱のSkill Creator、Anthropicの`skill-creator`（導入済み）と三重。
- **skillの中の資産は外に出す。** `yoki-artifact`の230MB（Workerのビルド成果物）、`dopa-shorts`の345MB（動画）、`writeup-kit`の23MB（バイナリ）、`grilling`の9.2MB。skillは手順で、成果物置き場ではない。

## Alternatives considered

- **他の候補（brainstorming、finishing-a-development-branch、subagent-driven-development）も入れる**: 「ある方がよさそう」止まりで、確認された穴が無い。入れない。
- **文書処理（docx/pdf/pptx/xlsx）やskill作成のskillを自作する**: Anthropicのskillsが同梱し導入済み。却下。
- **資産をskillに置いたままにする**: 約600MBがsymlink経由で各ハーネスのskill置き場に見え、複製や配布のたびに付いて回る。却下。

## Consequences

- obraの二本は全文を読んでから`skills/`に置く。出所とpinned commitを記す（`natural-japanese/UPSTREAM.md`と同じ形）。
- 資産の移し先はskillと同じリポジトリの外か、リポジトリ内のskill以外の場所（当時は`domains/`の別の場所。`domains/`は52411843で消えた）。skillからは相対パスで参照しない。
- 「本数が精度を下げる」数字は無い（Anthropicの「Too many tools or overlapping tools can also distract agents」は定性）。測れているのは追従率だけ。

## Sources

- obra/superpowers: https://github.com/obra/superpowers 、公式pluginのスキャン結果: https://github.com/anthropics/claude-plugins-official/issues/5704
- writing-skillsが三重になる根拠（Codex側Skill Creator）: https://learn.chatgpt.com/codex/build-skills 、（Anthropic側skill-creator）: https://github.com/anthropics/skills
- Anthropic: https://www.anthropic.com/engineering/writing-tools-for-agents 、Claude Code: https://code.claude.com/docs/en/skills.md

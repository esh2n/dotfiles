# モデルが読む物は英語で書き、人が読む物は日本語のまま、継ぎ目は決定メモの英語一行を人が書く

Status: accepted — 多言語の指示追従ベンチマークは全モデルで日本語が英語に 11〜20 点劣り、トークンは日本語が不利で、最も採用率の高い日本の実践者の 95% が英語で書いている。ベンダーの指針は無い（2026-09-23）

rule: Write everything the model reads (AGENTS.md rules, SKILL.md incl. descriptions, hook-injected text, subagent definitions, judgment-question framing) in English; keep decision notes, research records, writeups and the owner's own prompts in Japanese; each decision note carries a human-written English `rule:` line that the generator copies verbatim into AGENTS.md — no machine translation in between.

## Problem

ハーネスの設定ファイルは言語が混在している（SKILL.md の大半は英語、`natural-japanese` は日本語、決定メモは日本語、CLAUDE.md は英語）。モデルが読む物（規則、skill、フックが差し込む文、サブエージェント定義、jev の質問の枠）を英語にすべきか、日本語のままでよいか。人が読む物（決定メモ、調査記録、writeup、プロンプト）との継ぎ目をどう持つか。

## Decision

- **モデルが読む物は英語。** AGENTS.md の規則、SKILL.md（特に `description`）、フックが差し込む文、サブエージェント定義、jev の質問の枠。
- **人が読む物は日本語のまま。** 決定メモ、調査記録、writeup、あなたのプロンプト、私の返答。
- **継ぎ目は自動翻訳しない。** 各決定メモの先頭に、裁定の時点で人（私）が書く英語一行 `rule:` を持たせ、生成器はそれをそのまま AGENTS.md の太字一行に写す。日本語の本文と英語の一行を同時に確認できる。
- 日本語そのものを扱う skill（`natural-japanese` など）は、指示は英語、例文は日本語。
- jev の質問の枠も英語にする（手元の測定は 79.0% 対 76.5% で CI が重なるが、方向は一致し、反対側の根拠が無い）。

## Alternatives considered

- **日本語のままにする**: M-IFEval（2025-02、8 モデル、Claude 3.5 Opus/Sonnet/Haiku 込み）で日本語の指示追従は英語より 11.0〜20.1 点低く例外なし、日本語固有でない指示に絞っても差は残る（Sonnet 88.1 → 81.2）。トークナイザの不公平（同じ内容で言語により最大 15 倍）。Claude Code 自身の思考要約は、韓国語設定と CLAUDE.md の指示があっても 84.5% が英語優勢（#87367、日本語でも #82785）。skill の一覧は文脈の 1% で切り詰められ、42 本の日本語 description で予算の 703% という実測（moname_ai）。100 万アカウントの実測で指示ファイルの約 95% が英語、日本は採用率世界 1 位（33.1%）。却下。
- **自動翻訳で継ぎ目を埋める**: 「決定を日本語で書きルールを英語で生成する」道具は無い（rulesync は書式変換のみ）。翻訳の誤りが規則の誤りになり、人が確認できない。却下。人が書く一行にする。
- **モデルが読む物も混在のまま**: 現状。どちらの根拠にも立たない。却下。

## Consequences

- 生成器は決定メモの `rule:` 行を集めて AGENTS.md の太字一行にする。`rule:` の無い決定メモは AGENTS.md に載らない（載せたいなら書く）。既存の決定メモに `rule:` を足す。
- 日本語で書かれた SKILL.md と description は英語に書き換える。
- 前例なし: 現行世代モデルでの英日の差の再測定、SKILL.md の言語だけを変えて呼び出し率を測った実験、この継ぎ目を自動化した道具。ベンダーの指針も無い。

## Sources

- `rules/research/2026-09-23-model-facing-language.md`
- M-IFEval: https://arxiv.org/abs/2502.04688 、トークナイザ: https://arxiv.org/abs/2305.15425
- Claude Code の issue: https://github.com/anthropics/claude-code/issues/87367 、/82785 、/21400
- 実測: https://qiita.com/hisashi-ito/items/62bdc1a983f3f7dc649a 、skill の予算: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices

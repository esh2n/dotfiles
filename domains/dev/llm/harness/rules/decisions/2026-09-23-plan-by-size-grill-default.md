# 設計の重さは仕事の大きさで決め、既定は「詰めてから短い決定記録」、仕様文書は大きく曖昧な仕事だけ短く一枚

Status: accepted — 五社中四社が大きさで計画を gate し、最も詳しい実践者は多文書の SDD を「小さい仕事に大槌」と報告、人が書く仕様文書の唯一の統制実験は否定側、一律の SDD を捨てたコミットが実在する（2026-09-23）

## Problem

「ちゃんと設計してから進める」をどう実装するか。手元には Spec Kit 型の `sdd` skill（constitution → specify → plan → tasks → implement の多文書）と、chat で証拠を突き合わせて詰める `grilling` があった。SDD は業界で正しい実践とされているのか、既定をどちらにするかを決める。

## Decision

- **既定は grilling + 短い決定記録**。設計は chat で「何を決めるか」を一つずつ、四方向の証拠で詰め、結論は `rules/decisions/` の短い Markdown に残す（`2026-09-22-decision-records.md` の三部基準）。
- **入口の規則は一行**: diff を一文で言えるなら計画なし。複数ファイルにまたがるか手法が不確かなら grilling。大きく曖昧なら sdd。
- **sdd は残すが縮める**: 対象は「大きく、曖昧で、複数ファイルにまたがる仕事」だけ。中身は Spec Kit 型の五段を捨て、Anthropic/Codex 型にする — インタビューで詰める（不確かなら計画せず問う）→ 自己完結の短い SPEC 一枚（触るファイルと境界、範囲外、end-to-end の検証手順、3〜5 節）→ 新しいセッションで実装。constitution/specify/plan/tasks の多文書は作らない。
- 「grilling が SDD より優れている」という直接の証拠は無い。この決定は、ベンダーの gating、実践者の実測、否定側の統制実験、捨てたコミットの収束による。

## Alternatives considered

- **一律の SDD（Spec Kit 型）を既定にする**: Spec Kit（138,339 星）は五段を一律に課しサイズの下限を書かず、README に数値の主張はゼロ。五社中四社は逆で、Anthropic「Plan mode is useful, but also adds overhead… If you could describe the diff in one sentence, skip the plan」、Codex の plan mode は「chat your way to a great plan… if any high-impact ambiguity remains, do NOT plan yet — ask」で出力は 3〜5 節、Cursor「quick changes… jumping straight to Agent mode is fine」、Devin「3 時間以下ならそのまま」、Kiro は Feature/Quick/Bugfix の三段。Böckeler（martinfowler.com、Kiro と Spec Kit を実使用）は小さなバグ修正で「4 ストーリー 16 受け入れ基準」「sledgehammer to crack a nut」、3〜5 ポイントの機能で「overkill、実装を終えられなかった、普通に書けば同じ時間で制御できた」「markdown の山よりコードをレビューしたい」。唯一の統制実験（OpenHarmony Bench）は仕様駆動の課題がビルドは通るのに完了率が三形式で最下位（35% 未満）。捨てたコミット: elastic/cli「drop spec-kit artifacts in favor of AGENTS.md」、quickstart-now/hejbro「revert: drop spec kit adoption」ほか。抜き取り 5 リポジトリで code の後に spec が更新された例ゼロ（最長 98 日の乖離）。却下。
- **sdd を捨てる**: Böckeler も「spec-first の原理自体は多くの場面で価値がある」と原理は肯定し、Anthropic は大きな機能に「インタビューして `SPEC.md`」を公式に勧め、Kiro の Feature Spec の基準（複数要件・曖昧さが高くつく・レビューの関門が要る）も同じ範囲を指す。大きく曖昧な仕事の受け皿として短い形で残す。却下。
- **エージェント内部の計画（plan mode、in-loop の TODO）まで捨てる**: 別物。in-loop の計画は効く測定がある（From Plan to Action、21,120 軌跡で計画を外すと成功率が落ちる）。これは各ハーネスの plan mode に任せ、この決定の対象外。

## Consequences

- `sdd` skill の本文を書き換える（五段 → インタビュー + 短い SPEC）。`grilling` は既定の設計手順として AGENTS.md の一行から指す。
- 決定記録は短く拘束的、SPEC は大きな仕事の一時的な実装契約で、実装が終わったら決定記録に結論だけ残して SPEC は捨てる（spec と code の乖離を持たない）。
- 前例なし: 「spec 文書先行」対「詰めて短い決定記録」の直接比較。Kent Beck「specs are the new waterfall」は本人のアーカイブに無く未検証（本人の立場「次の一歩に要ることだけ伝える」は同方向）。

## Sources

- `rules/research/2026-09-22-spec-driven-development-evidence.md`
- Anthropic: https://code.claude.com/docs/en/best-practices 、Codex plan mode（生ソース）: https://github.com/openai/codex （codex-rs/collaboration-mode-templates/templates/plan.md）
- Cursor: https://cursor.com/docs/agent/planning 、Devin: https://docs.devin.ai 、Kiro: https://kiro.dev/docs/specs/best-practices/
- Spec Kit: https://github.com/github/spec-kit 、https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/
- Böckeler: https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- 測定: https://arxiv.org/abs/2608.16022 （OpenHarmony Bench）、https://arxiv.org/abs/2604.12147 （From Plan to Action）
- 捨てたコミット: elastic/cli #247、quickstart-now/hejbro #292

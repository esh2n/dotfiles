# レビューは review skill 一つを入口にし、レビュアーは考え方の型で 6 つに分け、指摘は別の文脈で反証する

Status: accepted — 持ち主の裁定（2026-10-19）。レビュー体制の再設計案（言語、バックエンド、インフラ、クラウド、セキュリティ、フロントエンド、デザインの各領域の調査にもとづく）を受け入れた。`2026-09-22-subagents-and-workflows-by-scale.md` のうち、review と design-review をワークフローのスクリプトとして残す部分を置き換える（委譲の形と実行の分担の規則はそのまま）

rule: Review every change through the `change-review` skill: classify the diff (size, risky paths, UI), gather the intent, plan, decision notes and the project's workload file, run the project's static tools first and pass their output on (never claim "no issues" from a tool that did not run), spawn reviewers by reasoning mode — code-reviewer always, and security-reviewer, workload-reviewer, ui-reviewer (with before and after screenshots) and test-reviewer when the change calls for them — and have review-verifier try to refute each finding in a separate context. A heavy review (about 200 or more executable lines, or a risky path) adds a second review on a different model family through pstack's `interrogate`. Every finding states what fails, why, the fix and how to verify it; trade-offs and taste are questions for the owner, and absent inputs are missing context. Output goes to the owner — chat for five findings or fewer without screenshots, otherwise an Artifact page with a choice per finding — and nothing is posted to GitHub without the owner's approval. Review procedures live in skills and agents, never in workflow scripts.

## Problem

2026-10-19 時点のレビューは、入口と知識の置き場が割れていた。

- 入口が 3 つあった。単発の `code-reviewer` エージェント、多レーンの `review` ワークフロー（`harness/workflows/review.js`、約 55 KB）、設計を見る `design-review` ワークフロー（約 45 KB）。ワークフローは Claude Code の Workflow ツールでしか動かず、Codex では動かない（`2026-09-22-subagents-and-workflows-by-scale.md` の実機検証）。採否の規則（閾値、反証、重複の合わせ方）はスクリプトのコードの中にあり、エージェント定義や skill からは読めなかった。
- レビュアーが言語ごとに 22 本あり、言語の知識がエージェントの本文に閉じていた。コードを書くモデルはそれを読まないので、書くときとレビューのときで基準が違った。業界はレビュアーを言語ではなく考え方の型で分けている（compound-engineering の基準は「違う考え方が要るなら別の役にする」）。
- 見る人がいない観点があった。実負荷とユーザーストーリーを端から端まで追う人、画面をデザイナーの目で見る人、テストが振る舞いを守っているかを見る人。
- `security-reviewer` の Calibration は「疑わしきは報告」だった。AI のセキュリティレビューは素のままだと誤検知が多数を占める（Semgrep の測定で Claude Code 86%）。Write と Edit を持ち、検出と是正が一つの定義に同居していた。
- 指摘の書き方が「file:line — 問題 — 理由 — 修正」の一行で、その分野に詳しくない読み手は直すかどうかを決められなかった。AI の指摘は 56.3% が却下されている（CodeRabbit、31,073 件）。
- 結果を GitHub に許可なく出す経路を止める規則が無かった（guard は 2026-10-19 に `ask-gh-pr-comment` で止めた）。

## Decision

1. **入口は `change-review` skill 一つ。** 日常の軽いレビューも厚いレビューも同じ手順で、深さだけが変わる。手順は、変更の分類（大きさ、危険な経路: 認証、秘密情報、お金、公開 API、移行、CI、依存、LLM の機能、UI かどうか）→ 文脈を集める（PR の説明、チケット、計画、受け入れ条件、関係する決定メモ、プロジェクトのワークロード記述）→ 静的ツールを先に走らせ、結果をレビュアーに渡す → 分類に応じてレビュアーを立てる → review-verifier が指摘を 1 件ずつ別の文脈で反証する → 報告。設計書の段階のレビューと、コードベース全体のセキュリティ監査は、同じ skill の別の手順（`references/design-review.md`、`references/security-audit.md`）にする。
2. **厚いレビュー**（実行される行がおよそ 200 行以上、または危険な経路に触れる）では、pstack の `interrogate` で別のモデル系列による二つ目のレビューを足す。Claude Code からは Codex に 1 回だけ委ねる。omp・pi・DSH からは系列の違う tier を使い、無ければ同じく Codex に 1 回委ねる。読み替えは `pstack-adapter` の Review 節に置く。セキュリティの指摘一覧は外部の提供元に送らない。
3. **レビュアーは考え方の型で 6 つ。** モデル名は書かず tier だけ（`2026-10-19-model-assignment.md`）。
   - `code-reviewer`（main / high）: 差分の正しさ。変更された言語の基準と関係する領域のチェックリストを読む。性能は節の一つ。
   - `security-reviewer`（complex / high）: 差分が持ち込んだ問題だけ。読み取り専用。攻撃者・能力・経路・影響を言えない指摘は出さない。信頼度は根拠の段階で決める。「疑わしきは報告」はやめる。
   - `workload-reviewer`（新設、main / high）: バックエンドはリクエストあたりのクエリ数、競合、再試行の増幅、先に詰まる資源、コスト。フロントエンドはユーザーストーリーを正常、エラー、空、遅い通信、二度押し、同時操作、権限、オフライン、一部失敗、戻る、古いキャッシュの各パターンで追う。ワークロードの記述が無ければ数値を出さず「足りない資料」として書く。
   - `ui-reviewer`（新設、main / high）: 変更前後のスクリーンショットと差分をデザイナーの目で見る。根拠はプロジェクトのデザインシステムを先に、次に複数の公開のもの（SmartHR、デジタル庁、freee、Material、Apple HIG、NN/g）を並べ、一致は根拠、食い違いは選択肢として出す。仕様が決まっている変更（モード A）はすべて出典付きの提案、仕様が無い変更（モード B）は測れる破綻だけ指摘で好みは問い、判断がつかなければモード A。断定は実測値かコードで確かめられるものだけ。
   - `test-reviewer`（新設、main / high）: テストが振る舞いを守っているか。壊れても通るテストでカバレッジを水増ししない。
   - `review-verifier`（新設、tier と effort は呼び出し元を継ぐ）: 指摘を 1 件受け取り、読み取りだけで反証を試み、holds / does not hold / cannot verify を返す。反証できないことは正しさの証拠にしない。
4. **指摘の形を一つにする。** 何が問題か（具体的な入力や状況）、なぜか（仕組み。専門用語は残し、初出でその場で説明する。たとえ話は使わない）、どう直すか（差分とその読み方）、どう確かめるか（テストかコマンド、出典の URL）。指摘、人への問い（トレードオフ、好み、設計判断）、足りない資料を分けて書く。実行したツールと立てたレビュアー、立てなかったレビュアーとその理由を報告に載せ、省略が見えるようにする。
5. **結果は持ち主に返す。** GitHub へは持ち主が文面を承認するまで出さない。指摘が 5 件以下でスクリーンショットが無ければチャットに番号付きで、それ以外は指摘ごとに「直してもらう / 自分で直す / GitHub にコメント / 却下」を選べる Artifact のページで返し、選んだ結果をモデルが読み戻す（ページはまだ作らない。それまではチャット）。自分の作業中の変更なら、確かめられた blocker と major は自分で直して報告する。却下は誤検知として記録し、同じ項目の却下が続けば外し、見逃しが出たら 1 項目足す。
6. **ワークフローを退役する。** `harness/workflows/review.js`、`design-review.js` と、使われていなかった `lib/lanes.js` を消す。スクリプトが守っていた規則（新しい文脈、プロジェクトが書いた決定に根拠を置く、差分に錨を下ろす、閾値をコードで守る、反証は別の文脈で、上限を超えた分は未検証として残す、重複は和集合で合わせる、捏造しない、セキュリティの指摘を外に出さない）は `code-review-discipline` の 12 節に移す。
7. **段階を分ける。** 今回は段 1（レビュアー 6 本、review skill、pstack-adapter の Review 節）。言語ごとのレビュアー 22 本は消さない。段 2 で各言語 skill に `references/review-standard.md` を書き、その言語の基準ができたものから、そのレビュアーを立てるのをやめる。それまでは review skill の `references/language-map.md` が言語の skill とレビュアーを対応づける。

## Alternatives considered

- **ワークフローのスクリプトを残し、レーンを足す**: Codex で動かず、omp ではシムが要る（09-22 の実機検証）。規則がコードに埋まり、エージェントにも書くモデルにも読めない。個人の開発者の受け入れられた形は「1 つの新しい文脈のレビュアーを、手元で、必要なときに」で、保存したレビュー用ワークフローを日常に使う名前のある実践者は見つからなかった。却下。
- **言語ごとのレビュアーを増やし続ける**: 22 本でも知識が書く側に届かず、言語の数だけ同じ作りが重複する。compound-engineering は同じ規則が 3 つの persona に重複したのを失敗として記録し統合を計画した。superpowers も 2 本のレビュアーを 1 本に統合した。言語の知識は skill に置き、レビュアーは考え方で分ける。却下。
- **全部のレビュアーを毎回立てる**: Anthropic の自社データで、50 行未満の PR は 31% にしか指摘が出ず平均 0.5 件。compound-engineering は「56 行の変更が 600 行の変更とほぼ同じ費用」を失敗として記録し、危険度の判定を入口に置いた。常時 1 本と条件付きにする。却下。
- **反証の段を置かない**: 単一の指摘に対する多数の一致は誤りうる（OpenSSL に存在しない padding oracle を 10 人のレビュアーが全員一致で支持した。反証で候補の 79〜83% が落ちた、arXiv 2604.19049）。compound-engineering の validator も「Never use lack of disproof as evidence of confirmation」と書く。却下。
- **反証を同じレビュアーに自己点検させるだけにする**: 書いた文脈を引き継ぐと同じ盲点を引き継ぐ。各レビュアーの自己点検は残し、それとは別に新しい文脈の verifier を置く。
- **二つ目のレビューを同じモデルでもう一度回す**: pstack の interrogate 自身が「敵対的な信号はモデルの多様性から来る」と書く。今の adapter の読み替えでは二つとも同じモデルになり、一致が相関した盲点にすぎなくなる。却下。
- **セキュリティを「疑わしきは報告」のまま残す**: 誤検知が多数を占める測定（Semgrep 86%、Heelan の実験で約 78%）があり、根拠が無い。却下。
- **ui-reviewer に見た目の判断を指摘として断定させる**: スクリーンショットを 1 枚だけ見せる方式は適合率 0.09（Android の表示バグ、arXiv 2607.04120）、UI 診断のベンチマークでも Claude は 6 割台（arXiv 2606.13192）。断定は実測とコードに限り、好みは問いにする。却下。
- **結果を PR に直接投稿する**: 他人に見える書き込みで、AI の指摘の過半は却下されている。持ち主の承認を挟む（guard の `ask-gh-pr-comment` と同じ線）。却下。

## Consequences

- `harness/agents/` に `workload-reviewer`、`ui-reviewer`、`test-reviewer`、`review-verifier` が増え、`code-reviewer` と `security-reviewer` を書き直した。`security-reviewer` は読み取り専用になり、`harness/docs/reviewer-requirements.md` の Known deviation は無くなった。6 本は根拠の段階で決める信頼度（100 / 75 / 50）と 4 項目の指摘の形を共有する。言語と性能のレビュアーは段 2 まで `[C:x/I:x]` のまま。
- `harness/skills/change-review/` を新設し、`code-review-discipline` に 12 節を足し、`rules/common/60-delegation.md` のレビューの行と `pstack-adapter` の Review 節を書き換えた。
- `~/.claude/workflows/` から review.js、design-review.js、lib へのリンクが消える（jig apply）。残るワークフローは research と implement。
- 言語ごとのレビュアー 22 本の本文には「review workflow の言語レーン」への言及が残る。段 2 で各言語の基準に知識を移すときに直す。`resilience-patterns`・`event-driven-patterns`・`observability-patterns` の `review-checklist.md` 冒頭の「review / design-review workflows が読む」、`research.js` の「lanes.js が正本」というコメント、`writeup` と `artifact` の skill の design-review ワークフローへの言及も古くなった。
- 静的ツール（osv-scanner、gitleaks、zizmor、semgrep）を guard で許可するかは未決。許可が無い環境では「未実行」と書く。
- Claude 以外のモデルにコードを渡すこと（厚いレビューの Codex への委任）は、この裁定で厚いレビューに限って認めた。反証の段を別系列にするかは未決のまま。
- omp・pi・DSH では今の tier（main と complex がどちらも DeepSeek、executor はレビューに使わない）に別系列が無く、厚いレビューの二つ目は Codex への委任になる。
- Artifact のページ（指摘ごとの選択と保存）は未作成。作るまでは件数にかかわらずチャットで番号付きで返す。
- 測り方: 過去の修正コミット（問題のある差分）と問題のない差分を少し集め、検出数と誤検知数を前後で数える。公開された測定が無いので、これが唯一の根拠になる。

## Sources

- compound-engineering のレビュアー構成、信頼度の段階、validator、統合案: https://github.com/EveryInc/compound-engineering-plugin 、https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/plans/ce-code-review-reviewer-consolidation-and-standards-file.md
- ClickHouse のレビュー skill（足りない証拠でも重大になりうる指摘を抑えない）: https://github.com/ClickHouse/ClickHouse/blob/master/.claude/skills/review/SKILL.md
- Anthropic のマネージド Code Review と PR の大きさごとの指摘率: https://code.claude.com/docs/en/code-review 、https://claude.dev/blog/solving-code-review-at-anthropic/
- pstack の interrogate（モデルの多様性）: https://github.com/cursor/plugins/tree/main/pstack/skills/interrogate
- 静的解析の結果を渡す効果（検出 96.9%）: https://arxiv.org/abs/2602.16741
- AI の指摘の採否（却下 56.3%）: https://arxiv.org/abs/2607.03316
- 全員一致でも誤る例と反証の効果: https://arxiv.org/abs/2604.19049
- 文脈ファイルの費用と効果: https://arxiv.org/abs/2602.11988
- スクリーンショット単独の UI 不具合検出（適合率 0.09）: https://arxiv.org/pdf/2607.04120 、UI 診断のベンチマーク: https://arxiv.org/abs/2606.13192
- OWASP Secure Code Review（差分と全体の二種類）: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html 、ASVS 5.0: https://github.com/OWASP/ASVS
- メタ安定障害と再試行の増幅: https://brooker.co.za/blog/2021/05/24/metastable.html 、https://sre.google/sre-book/addressing-cascading-failures/
- デザインの根拠: https://smarthr.design/products/design-patterns/spacing-layout-pattern/ 、https://smarthr.design/products/design-patterns/visual-guidance/ 、https://design.digital.go.jp/dads/foundations/spacing/ 、https://design.digital.go.jp/dads/foundations/color/

# レビュアーにspec-reviewerとrollout-reviewerを足し、個人データの確認はsecurity-reviewerの節として持たせる

Status: accepted — 持ち主の裁定（2026-10-19）。`2026-10-19-review-redesign.md`の6本のレビュアーに2本を足す。分類、反証、指摘の形、報告の行き先はその記録のとおり

rule: The `change-review` skill also spawns `spec-reviewer` (main/high) when there is a PR description, ticket, plan, acceptance criteria or decision note to compare against, or when docs or a public surface change — it matches documents to the diff item by item (missing, extra, misunderstood), lists docs that should change with the diff, checks PR hygiene, and puts product fit to the owner as questions, reporting an absent document as missing context instead of guessing intent — and `rollout-reviewer` (main/high) when an API, event, schema, stored format, migration, feature flag, config default or deploy order changes — it reviews the window where old and new versions run together: compatibility in both directions, expand-migrate-contract order, backfill and rollback, flag defaults and cleanup, per-environment config, and whether the PR split matches the deploy order. Privacy is a section of `security-reviewer`, run when a change collects, stores, logs, sends or deletes personal data; there is no separate privacy reviewer.

## Problem

`2026-10-19-review-redesign.md`で決めた6本のレビュアー（code、security、workload、ui、test、review-verifier）は、どれも差分のコードをコードそのものと照らして読む。次の3つの問いには、担当するレビュアーがいなかった。

- 変更が、頼まれたことと合っているか。PRの説明、チケット、計画、受け入れ条件（何ができれば完了とするかを書いた条件）、決定メモと差分を突き合わせる人がいなかった。頼まれたのに入っていないもの、頼まれていないのに増えた公開の振る舞い、読み違えたものは、コードだけを読んでも見えない。READMEや変更履歴（CHANGELOG）を差分と一緒に直すべきかも、誰も見ていなかった。
- 古いバージョンと新しいバージョンが同時に動く間に壊れないか。デプロイ（新しいバージョンを本番に出す作業）の途中では、サーバーは一台ずつ入れ替わり、古いクライアントやキャッシュやキューに残ったメッセージがしばらく残る。切り戻すと、新しいバージョンが書いたデータを古いバージョンが読む。`code-reviewer`の点検項目に「移行の途中で古い読み手と書き手が動くか」という一行はあるが、移行の順序、フィーチャーフラグ（設定で機能を切り替える仕組み）、環境ごとの設定の既定値までは見ていなかった。設計書の段階のレビュー（`references/design-review.md`）のreleaseの観点には同じ問いがあったが、そこで使うエージェントが無かった。
- 個人データが、どこから入り、どこに保存され、どのログに書かれ、どの外部の提供元に送られ、いつ消えるか。`security-reviewer`はログに個人情報を書かないかを1行だけ見ていた。

## Decision

1. **`spec-reviewer`を足す**（main / high、読み取り専用）。差分と文書（PRの説明、チケット、計画、受け入れ条件、関係する決定メモとADR、README、APIの文書、変更履歴）を項目ごとに突き合わせる。
   - 抜け（頼まれたのに無い）、余分（頼まれていない振る舞いや公開の入口）、読み違い（言葉は合っているが意味が違う）を、要件の行と差分の行の両方を引いて指摘する。
   - 差分と一緒に直すべき文書（README、APIの文書、変更履歴、移行の手順）が直っていなければ指摘する。
   - PRの作り方を見る。一つのPRが一つのまとまった変更になっているか、リファクタリングや整形が振る舞いの変更と分かれているか、説明が何をなぜ変えたかと、その欠点を書いているか。
   - 製品として要るかどうか（そもそも要るか、既にある機能と重ならないか、あとで外せるか）は指摘にせず、持ち主への問いにする。
   - 再レビューでは、前の指摘が直ったかを1件ずつ確かめる。
   - 文書が無いときは、コードから意図を推測して比べない。足りない資料として報告する。
2. **`rollout-reviewer`を足す**（main / high、読み取り専用）。古いバージョンと新しいバージョンが同時に動く間を見る。
   - API、イベント、保存形式の互換性を見る。古いバージョンが書いたものを新しいバージョンが読めるか（後方互換）と、新しいバージョンが書いたものを古いバージョンが読めるか（前方互換）の両方を見る。名前の変更は「追加」と「削除」の二つに分ける。必要ならバージョンを上げる。Hyrumの法則（使う人が十分に多ければ、外から見える振る舞いはどれも誰かに頼られる）も考える。
   - 移行の順序を見る。順序はexpand（新しい構造を足す）、migrate（データを移して読み先を切り替える）、contract（古い構造を消す）で、各段は別のデプロイにする。バックフィル（既存のデータを新しい形に埋める処理）の検証と、切り戻しの可否も見る。
   - フィーチャーフラグを見る。既定値、止めるためのスイッチとして使えるか、消す日、全部のフラグを有効にした状態のテストを見る。
   - 設定の既定値と環境ごとの値を見る。
   - PRの分け方がデプロイの順序と合っているかを見る。スキーマ、コード、削除は、別々にデプロイできる段に分ける。
   - 設計書の段階のレビューでは、releaseの観点をこのエージェントが受け持つ。
3. **個人データの確認は`security-reviewer`のPrivacy節にする。** 個人データを、入ってきた場所から、保存先、ログ、外部の提供元、削除まで追う。用途に要らない項目を集めていないか（データ最小化）、保存期間と消す手段があるか、保存する地域（バックアップとログを含む）、同意が要る処理で同意を取っているか、を見る。脅威の名前にはLINDDUNの分類（linking、identifying、non-repudiation、detecting、data disclosure、unawareness、non-compliance）を使う。法律が当てはまるかどうかは指摘にせず、持ち主への問いにする。
4. **`change-review`の分類に3つの印を足す。** spec、rollout、privacyを足す。どれも軽い・重いの区別とは別で、立てるレビュアーを決めるだけにする。文脈を集める段で、デプロイの形（一台ずつ入れ替えるか、移行をコードの前に流すか、古いクライアントをいつまで支えるか、切り戻しの手順）を探し、`rollout-reviewer`に渡す。意図を書いた文書は要約ではなくパスのまま`spec-reviewer`に渡す。
5. 2本とも、ほかのレビュアーと同じ指摘の形（何が問題か、なぜか、どう直すか、どう確かめるか）と、根拠の段階で決める信頼度（100 / 75 / 50）を使う。

## Alternatives considered

- **レビュアーを3本足す（個人データを別のレビュアーにする）**: 個人データの確認は、入力を入口から出口まで追う読み方で、`security-reviewer`が攻撃者の入力を追う読み方と同じである。別のレビュアーにすると、同じ経路を2本が読み、同じ指摘が2回出る。却下。
- **`code-reviewer`に2つの観点を足す**: 差分のコードを正しさの面から読むことと、文書と突き合わせること、複数のバージョンが同時に動く状態を順に追うことは、読み方が違う。一つの長いプロンプトに混ぜると、どの読み方も浅くなる。compound-engineeringは、同じ規則が3つのレビュアーに重複したことを失敗として記録し、読み方ごとに分けて統合する計画を書いている。却下。

## Consequences

- `harness/agents/`に`spec-reviewer.md`と`rollout-reviewer.md`が増えた。`security-reviewer.md`にPrivacy節が増えた。
- `harness/skills/change-review/SKILL.md`の分類表と、レビュアーを立てる表に行が増えた。`references/design-review.md`のconventionsとreleaseの観点に、使うエージェントを書いた。`rules/common/60-delegation.md`のレビューの行と、セキュリティの行を書き換えた。`harness/docs/reviewer-requirements.md`のレビュアーの数を8本にした。
- `code-reviewer.md`の冒頭にある「ほかのレビュアーの担当」の一覧と、`pstack-adapter`のReview節には、まだ2本の名前が無い。次に直すときに足す。
- 文書の無いリポジトリでは、`spec-reviewer`の報告はほぼ「足りない資料」だけになる。それが、文書を書くかどうかを持ち主が決める材料になる。
- デプロイの形が書かれていないリポジトリでは、`rollout-reviewer`は、どの一台ずつの入れ替えでも起きる順序の問題だけを指摘し、残りは足りない資料に回す。
- 測り方は`2026-10-19-review-redesign.md`と同じで、過去の修正コミットで検出数と誤検知数を数える。

## Sources

- Google Engineering Practices、レビューで見ること（Functionality、Documentation）: https://google.github.io/eng-practices/review/reviewer/looking-for.html
- Google Engineering Practices、小さな変更: https://google.github.io/eng-practices/review/developer/small-cls.html
- Google Engineering Practices、変更の説明の書き方: https://google.github.io/eng-practices/review/developer/cl-descriptions.html
- obra/superpowersのタスクのレビュアー（Missing、Extra、Misunderstood）: https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/task-reviewer-prompt.md
- ClickHouseのレビュー skill（Contract、Backward compatibility、Safe rolloutの各節）: https://github.com/ClickHouse/ClickHouse/blob/master/.claude/skills/review/SKILL.md
- Keep a Changelog: https://keepachangelog.com/en/1.1.0/
- Conventional Commits: https://www.conventionalcommits.org/en/v1.0.0/
- Google AIP-180、後方互換: https://google.aip.dev/180
- Semantic Versioning 2.0.0: https://semver.org/
- Martin Fowler、ParallelChange: https://martinfowler.com/bliki/ParallelChange.html
- Stripe、オンラインでの大規模なデータ移行: https://stripe.com/blog/online-migrations
- Pete Hodgson、Feature Toggles: https://martinfowler.com/articles/feature-toggles.html
- The Twelve-Factor App、Config: https://12factor.net/config
- Hyrumの法則: https://www.hyrumslaw.com/
- GDPR第25条（設計と既定によるデータ保護）: https://gdpr-info.eu/art-25-gdpr/
- LINDDUNのプライバシー脅威の分類: https://linddun.org/
- OWASP ASVS 5.0（V14 Data Protection）: https://github.com/OWASP/ASVS
- compound-engineeringのレビュアー統合案（重複の失敗）: https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/plans/ce-code-review-reviewer-consolidation-and-standards-file.md

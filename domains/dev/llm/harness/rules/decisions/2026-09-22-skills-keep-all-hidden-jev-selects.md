# skill は全部持ち、一覧には載せず、jev が選ぶ。外からは二本入れ、重複と資産は外に出す

Status: accepted — 選択の費用を毎ターンのモデルに払わせず判断サービスに寄せる設計。ただし追従率 6% の原因調査が先（2026-09-22）

## Problem

skill が 88 本あり、30 日間で 34 本は一度も開かれていない。skill は説明文が一覧に載るだけで文脈を食う（Claude Code は 1 本 1,536 文字、Codex は一覧全体を文脈の 2%）。休眠分を消すか、`paths:` で触ったときだけ載せるか、一覧から外して別の仕組みで選ぶか。外から入れる価値がある skill はあるか。重複と、skill の中に置かれた大きな資産をどうするか。

## Decision

- **休眠の skill は消さない。** 元の設計は「全部持つが、ハーネスの一覧には載せず、jig の判断サービス（jev）がプロンプトごとに選んで差し込む」。88 本の中から毎ターンモデルに選ばせる費用を払わず、選択の費用を判断サービスに寄せる。`paths:` で触ったときだけ載せる案は、一覧に載せる前提の案なので取らない。
- **ただし実測の追従率が 6%**（注入 210 回、従われた 12 回）なので、設計どおりに動いているかを先に調べる。(1) 本当に一覧から外れているか、(2) 従われなかった 198 回で何が起きたか（注入が届いていない／開き方が示されていない／選択が誤り／小さな仕事で不要と判断／集計の定義）。動いていなければ packs のような機構をもう一度検討する。**調査の結果で本メモを更新する。**
- **外から二本入れる**: obra/superpowers の `using-git-worktrees`（作業を worktree で隔離する。「main のチェックアウトを他のエージェントがブランチ切替する」事故に対応）と `verification-before-completion`（完了を言う前に検証コマンドの出力を確認する）。どちらも今の 88 本に無い役割。導入前に全文を読む（公式 plugin リポジトリでさえ第三者スキャナが critical 3 件・high 11 件を出した）。
- **`writing-skills` は捨てる。** Codex 同梱の Skill Creator、Anthropic の `skill-creator`（導入済み）と三重。
- **skill の中の資産は外に出す。** `yoki-artifact` の 230MB（Worker のビルド成果物）、`dopa-shorts` の 345MB（動画）、`writeup-kit` の 23MB（バイナリ）、`grilling` の 9.2MB。skill は手順で、成果物置き場ではない。

## Alternatives considered

- **休眠 34 本を削除する**: 使う言語が変わったときに書き直しになる。費用の問題は一覧に載せなければ消えるので、削除は費用の解決策として過剰。却下。
- **`paths:` で触ったときだけ一覧に載せる**: Claude Code には `paths:` frontmatter がある（「loads the skill automatically only when working with files matching the patterns」）が、これは「一覧に載せる」設計の中の工夫で、他の四つのハーネスに同等が無い。jev 選択の設計と両立しない。却下（jev の設計が動かないと分かったときの候補として残す）。
- **skill router を外し、各ハーネスのネイティブ選択に任せる**: 6% を理由に一度提案した。ネイティブ選択は 88 本の説明を毎ターン一覧に載せる費用を払う形で、それを避けるのが元の設計。原因を調べる前に外すのは早い。却下（調査待ち）。
- **他の候補（brainstorming、finishing-a-development-branch、subagent-driven-development）も入れる**: 「ある方がよさそう」止まりで、確認された穴が無い。入れない。
- **文書処理（docx/pdf/pptx/xlsx）や skill 作成の skill を自作する**: Anthropic の skills が同梱し導入済み。却下。

## Consequences

- 生成器は skill をハーネスの置き場に配るが、一覧に載せない形（Claude Code は `skillOverrides`/`user-invocable` 相当、他は配布先の違い）で届ける。その形が各ハーネスで可能かは調査項目。
- `report skills` の測定は残し、Claude Code の `/skill-doctor` と突き合わせる。
- 「本数が精度を下げる」数字は無い。測れているのは追従率だけ。
- 前例なし: skill を一覧から外して外部の判断サービスが選ぶ設計の公開例は見つかっていない。obra/superpowers は 15 本に絞る（一覧に載せる前提の）設計。

## Sources

- `.tmp-research/skills-inventory-and-market.md`、`skill-router-6pct.md`（調査中）
- Claude Code: https://code.claude.com/docs/en/skills.md 、Codex: https://learn.chatgpt.com/codex/build-skills 、pi: https://pi.dev/docs/latest/skills.md
- Anthropic: https://www.anthropic.com/engineering/writing-tools-for-agents
- obra/superpowers: https://github.com/obra/superpowers 、公式 plugin のスキャン結果: https://github.com/anthropics/claude-plugins-official/issues/5704

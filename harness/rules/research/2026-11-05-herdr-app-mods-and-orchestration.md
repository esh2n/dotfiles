# Herdrデスクトップアプリのmod、エージェントの協調、advisorの調査

調査日 2026-11-05。対象はherdr-app 0.1.13、herdr-core（`hc`）0.1.18、Claude Code 2.1.318。検証はソースの読解、公式文書、issueで行い、アプリの実動作は未確認である。

## 結論

- prefixキーはアプリ本体に入らない。保守者は要望（#53）に対し「this works as a mod now」と答えて閉じ、公式見本`tmux-prefix`を示した。この見本は1回押した後のヒント表示と500ミリ秒の連打に対応する。
- `keys.json`は1文字でも編集すると、以後の既定キーを受け取らない。0.1.13では`cmd-f`の手動追記が必要だった。
- 同梱のレイアウトやmodの複製は更新されず、取り込む手段もない（#289、#520、#456）。
- modはレビューされない信頼済みJavaScriptで、`docs/security.md`は「That is not a security boundary.」と書く。369件のmodリポジトリのうち233件はスター0で、最古の更新は2026-10-29である。
- modを起動中に保存し続けると処理が劣化する。約85回の保存で描画が1.7ミリ秒から0.4〜1.4秒に延び（#88）、約8時間でmodの実行環境がメモリ不足になる（PR #575）。
- `~/.config/herdr-app`配下のmodをシンボリックリンクにすると再読み込みが効かず、iCloudの退避と重なると17.5秒止まる（#339）。
- orchestratorとworkerをSpaceで分ける構成は実例があるが、受け入れられた慣行とは言えない。herdr-core自身が`--bg`の子を隠して動かすことを既定とし、Spaceは「only create them when asked」と書く。
- `hc`に深さとトークンの上限はない（herdr #2742）。`blocked`は境界ではなく、`hc send --force`や`hc keys`で確認画面に答えられる。自動入力が本番ブランチへのmergeを承認した報告がある（herdr #5263）。
- 同梱のworktree modは`~/.herdr/worktrees`に作り、未コミットがあると`--force`で消す（`mods/worktree/main.js`）。`.claude/worktrees/<name>`の決定とは合わない。plain gitで作り、`herdr-app do space.new --folder`で開くなら合う。
- `--advisor`は実在し、`--help`に出ない隠しフラグである。`--subagents`はどの公式資料にも見つからない。同じ効果は`advisorModel`と`CLAUDE_CODE_SUBAGENT_MODEL`で得られる。
- advisorの呼び出しはモデルが決め、上限はなく、呼ぶたびに全履歴をキャッシュなしで読む。公開値はSonnetやHaiku単独との比較で、Opus単独との比較はない。
- ISUCON2026の記事は、Opus 5.5の1セッションが無人で完走した1回の記録である。advisorも並列エージェントも使っていない。スコアのノイズが大きく、監査サブエージェントの効果は著者自身が分離できないと書く。
- アプリの自動更新は、配布サーバーへの書き込み権限があれば鍵なしでコードを実行できる（`src/update.rs`）。ad-hoc署名を受け入れ、チームIDを固定せず、確認なしで`--version`を実行する。
- nixpkgsに`herdr-desktop`がある（2026-11-02追加、0.1.10、aarch64-darwin対応）。ソースビルドなので自動更新しないが、mod用のキーボード取得（0.1.12）より古い。

## 反証と未確認

- エコシステムは3週間しか経っておらず、modが更新を越えて動き続けるかは判断できない。
- 協調の費用はHerdr固有の測定がない。一般の数値として、Claude Codeのagent teamsは約7倍（plan時）、Anthropicのマルチエージェント調査は約15倍、CooperBenchは2エージェント協調で成功率30%減である。研究タスクの値はコーディングに直接当てはまらない。
- X上の投稿2件は取得できなかった。Zenn、Qiita、HN、Redditの利用記は見つからなかった。
- `tmux-prefix`の`main.js`は未読で、0.1.13での動作は未確認である。

## 出典

- https://github.com/herdrdev/herdr-app/issues/53
- https://github.com/herdrdev/herdr-layout-examples/tree/main/tmux-prefix
- https://github.com/herdrdev/herdr-app/blob/master/docs/security.md
- https://github.com/herdrdev/herdr-app/issues/88
- https://github.com/herdrdev/herdr-app/pull/575
- https://github.com/herdrdev/herdr-app/issues/289
- https://github.com/herdrdev/herdr-app/issues/339
- https://github.com/herdrdev/herdr/issues/2742
- https://github.com/herdrdev/herdr/issues/5263
- https://github.com/NixOS/nixpkgs/tree/master/pkgs/by-name/he/herdr-desktop
- https://code.claude.com/docs/en/advisor.md
- https://code.claude.com/docs/en/costs.md
- https://claude.com/blog/the-advisor-strategy
- https://arxiv.org/abs/2601.13295
- https://zenn.dev/luvtechno/articles/isucon2026-competition-day

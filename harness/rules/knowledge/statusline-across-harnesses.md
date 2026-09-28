# コーディングエージェントの statusline / footer は各ハーネスでどう作られているか

確認日: 2026-09-27

## 答え

「JSON stdin + 任意外部コマンド」という Claude Code の statusline 契約は、他のどのハーネスにも同じ形では存在しない。Claude Code は `~/.claude/settings.json` の `statusLine.command` に任意のシェルスクリプトを指定でき、セッション JSON を stdin で受け取り stdout をそのまま表示する、という言語非依存の契約を公式に持つ唯一のハーネスである。Codex CLI は固定の組み込み項目リスト（`model-with-reasoning`、`current-dir`、`git-branch` 等）のみで外部コマンドは呼べず、この欠落はベンダー自身が要望として認識しているが2026-09時点でも未実装（open issue）。pi と omp（pi のフォーク）はどちらも「TypeScript 拡張でフッターを描き替える」設計で、シェルスクリプトの持ち回しを前提にしていない。omp はさらに、pi からの移植時に `setFooter`/`setHeader` を意図的に stub（no-op）のまま残しており、pi 用に書かれたフッター拡張は omp では黙って何も描画されない——これは2026-09-27にメンテナ自身が「fork 時からの stub で直す予定のない設計判断」と確認している。DeepSeek Harness（DSH）はベンダーとして statusline 機能自体を持たず、すべてサードパーティの Cordis プラグインで代替されている。

採用実態も非対称で、Claude Code 向けは star 数万〜1万超級のツールが複数存在する「本物の市場」（Rust 実装まである）だが、他ハーネス向けの統合ツールは個人の実験リポジトリの乱立にとどまる。「1本のスクリプトを複数ハーネスで使い回す」実践は実在するが、いずれも小規模（星0〜5）で、Codex 側は機能を大きく落とした劣化互換（自由記述を諦め固定項目への変換）でしか成立していない。

否定側の証拠として、Claude Code 自身が stdin を EOF せず開いたままにするためプロセスが蓄積する運用不具合や、大規模リポジトリでの `git status` 等の遅さをベンダー自身が注意書きしている点もある。

## 根拠

- Claude Code の statusline 契約（外部コマンド + stdin JSON、300ms デバウンス） — https://code.claude.com/docs/en/statusline
- Codex に外部コマンド型の statusline が無く要望が未実装 — https://github.com/openai/codex/issues/17827（open）
- pi のフッター拡張 API（TypeScript、`setFooter`/`setStatus`） — https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md
- omp の `setFooter`/`setHeader` が全モードで no-op、メンテナが fork 時からの設計上の stub と確認 — https://github.com/can1357/oh-my-pi/issues/13473（2026-09-27）
- DSH に公式 statusline 機能が無く、コミュニティプラグイン（`ccch1mneyyy/dsh-TUI` 星3.6k 等）が代替 — GitHub API 直接取得
- Claude Code 向けツールの採用規模（jarrodwatts/claude-hud 28,186★、sirmalloc/ccstatusline 13,042★） vs 他ハーネスのロングテール — GitHub 検索 API（2026-09-27）
- Claude Code の stdin キープによるプロセス蓄積の運用不具合 — https://github.com/sirmalloc/ccstatusline/issues/485

## 注意点

- omp が将来 `setFooter` を修正する計画があるかは issue の triage コメント以上の情報に到達できていない。
- Claude Code・Codex・pi・omp・DSH の5つ全てに同時対応する単一 statusline ツールの実例は見つからなかった。
- DSH の公式ドキュメントサイトには直接アクセスしておらず、README 要約とサードパーティ記載のみに依拠している。
- Reddit / Hacker News 上の実践者スレッドはこの調査では扱っていない。

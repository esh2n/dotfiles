# コーディングエージェントのstatusline / footerは各ハーネスでどう作られているか

確認日: 2026-09-27

## 答え

「JSON stdin + 任意外部コマンド」というClaude Codeのstatusline契約は、他のどのハーネスにも同じ形では存在しない。Claude Codeは`~/.claude/settings.json`の`statusLine.command`に任意のシェルスクリプトを指定でき、セッションJSONをstdinで受け取りstdoutをそのまま表示する、という言語非依存の契約を公式に持つ唯一のハーネスである。Codex CLIは固定の組み込み項目リスト（`model-with-reasoning`、`current-dir`、`git-branch`等）のみで外部コマンドは呼べず、この欠落はベンダー自身が要望として認識しているが2026-09時点でも未実装（open issue）。piとomp（piのフォーク）はどちらも「TypeScript拡張でフッターを描き替える」設計で、シェルスクリプトの持ち回しを前提にしていない。ompはさらに、piからの移植時に`setFooter`/`setHeader`を意図的にstub（no-op）のまま残しており、pi用に書かれたフッター拡張はompでは黙って何も描画されない——これは2026-09-27にメンテナ自身が「fork時からのstubで直す予定のない設計判断」と確認している。DeepSeek Harness（DSH）はベンダーとしてstatusline機能自体を持たず、すべてサードパーティのCordisプラグインで代替されている。

採用実態も非対称で、Claude Code向けはstar数万〜1万超級のツールが複数存在する「本物の市場」（Rust実装まである）だが、他ハーネス向けの統合ツールは個人の実験リポジトリの乱立にとどまる。「1本のスクリプトを複数ハーネスで使い回す」実践は実在するが、いずれも小規模（星0〜5）で、Codex側は機能を大きく落とした劣化互換（自由記述を諦め固定項目への変換）でしか成立していない。

否定側の証拠として、Claude Code自身がstdinをEOFせず開いたままにするためプロセスが蓄積する運用不具合や、大規模リポジトリでの`git status`等の遅さをベンダー自身が注意書きしている点もある。

## 根拠

- Claude Codeのstatusline契約（外部コマンド + stdin JSON、300msデバウンス） — https://code.claude.com/docs/en/statusline
- Codexに外部コマンド型のstatuslineが無く要望が未実装 — https://github.com/openai/codex/issues/17827（open）
- piのフッター拡張API（TypeScript、`setFooter`/`setStatus`） — https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md
- ompの`setFooter`/`setHeader`が全モードでno-op、メンテナがfork時からの設計上のstubと確認 — https://github.com/can1357/oh-my-pi/issues/13473（2026-09-27）
- DSHに公式statusline機能が無く、コミュニティプラグイン（`ccch1mneyyy/dsh-TUI`星3.6k等）が代替 — GitHub API直接取得
- Claude Code向けツールの採用規模（jarrodwatts/claude-hud 28,186★、sirmalloc/ccstatusline 13,042★） vs他ハーネスのロングテール — GitHub検索API（2026-09-27）
- Claude Codeのstdinキープによるプロセス蓄積の運用不具合 — https://github.com/sirmalloc/ccstatusline/issues/485

## 注意点

- ompが将来`setFooter`を修正する計画があるかはissueのtriageコメント以上の情報に到達できていない。
- Claude Code・Codex・pi・omp・DSHの5つ全てに同時対応する単一statuslineツールの実例は見つからなかった。
- DSHの公式ドキュメントサイトには直接アクセスしておらず、README要約とサードパーティ記載のみに依拠している。
- Reddit / Hacker News上の実践者スレッドはこの調査では扱っていない。

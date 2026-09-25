# allow の規則は残し、ガードのポリシーの permit から生成する

Status: accepted — allow は分類器の前段で決定的に効き、auto モードも狭い allow を残す設計で、分類器は自社評価で見逃し 17%、allow を消した実践例は無い（2026-09-22）

rule: Generate permissions.allow from guard-rules.json's permit rules via to-claude-permissions.ts, not the old 71-entry config, and never write broad allow forms (Bash(*), whole interpreters, package-manager run); always permit git commit, git push on feature branches only (never main), and test commands (npm test, go test, pytest, bun test).

## Problem

Claude Code の `permissions.allow`（71 本、旧設定の層から生成）を、auto モード（分類器）と jig のガードがある前提で、全部消すか、残すか、別の元から生成するか。

## Decision

- allow は残す。元は旧設定の 71 本ではなく、`guard-rules.json` の permit の規則。`to-claude-permissions.ts` が permit を `Bash(<prefix> *)` / `Write(<glob>)` / `Edit(<glob>)` に、forbid を deny に翻訳し、翻訳できないもの（複雑な正規表現、net.fetch、mcp.call）は `hookOnly` として明示する。
- 広い形（`Bash(*)`、インタプリタ丸ごと、パッケージマネージャの run）は書かない。auto モードが落とすものは最初から出さない。
- 本当の強制は jig のフック（PreToolUse の deny は bypass でも効く）。native の deny はその後ろ盾。
- 既定の permit として最初から入れる三種: `git commit`、`git push`（feature ブランチ。main への push は forbid のまま）、テストの実行（`npm test`、`go test`、`pytest`、`bun test`）。分類器のサービス停止時に作業が止まらないための保険。
- 旧設定の 71 本は移行時に一本ずつ見る。狭くて日常的なもの（git の副コマンド、`npm run *` の個別、formatter）は permit に移し、`Edit(./**)` のような広いもの（auto の第 2 段が自動承認する）は捨てる。

## Alternatives considered

- **allow を全部消し、deny + フック + 分類器に任せる**: 当初の案。Claude Code の判定順序は「1. allow/ask/deny に一致する操作は即決 → 2. 読み取りと作業ディレクトリ内の編集は自動承認 → 3. それ以外が分類器」で、auto モードに入るときに落とされるのは広い allow だけ、「`Bash(npm test)` のような狭い規則は残る」と明記。Anthropic の設計文書も第一層を「組み込みの安全ツール一覧とユーザーの設定」とし「狭い規則は引き継ぐ」と書く。分類器は自社評価で実データの「やりすぎ」操作 52 件に対し見逃し 17%（「the honest number」）、合成の持ち出し 1,000 件で 5.7%、毎回 Sonnet 5 への往復が入る。allow に書いた操作を分類器が拒否する報告が 2026-07 から 09-22 まで 5 件以上（#95996、#83611、#88575、#85491、#76149）、deny が auto で無効化された報告（#88770）、分類器の停止で作業が 15 分止まった報告（#91517）。「auto があるから allow は不要」と述べた文書・記事はベンダーにも実践者にも無く、唯一の直接の実践例は「分類器に繰り返し拒否される正当な操作は allow に足す」と逆の運用。却下。
- **旧設定の 71 本をそのまま持ち越す**: 元が旧設定の層（`permissions.yaml` の core/packs/personal）で、`2026-09-22-config-layout-no-personal-layer.md` に反する。広い形（`Edit(./**)`、`WebFetch(domain:*)`）も含む。却下。

## Consequences

- 生成器の Claude Code 向けの出力に `permissions.allow` と `permissions.deny` が入り、どちらも `guard-rules.json` から派生する。二重管理は無い。
- `dontAsk` モード（allow に一致するものだけ動かす）が使える状態を保つ。
- 日常操作（`git commit` など）に対する分類器の精度は誰も測っていない。17% は「やりすぎ」操作の hard case の数字で、そのまま当てはめない。
- Codex には分類器も per-command の allow も無く（sandbox の profile 方式）、この決定は Claude Code に固有。pi・omp・DSH の権限モデルは未調査。

## Sources

- `rules/research/2026-09-22-allow-list-vs-auto-mode.md`
- 判定順序と auto モード: https://code.claude.com/docs/en/permission-modes.md 、規則: https://code.claude.com/docs/en/permissions.md
- 分類器の評価: https://www.anthropic.com/engineering/claude-code-auto-mode
- issue: https://github.com/anthropics/claude-code/issues/88770 、/95996 、/91517 、/83611
- 実践者: https://simonwillison.net/2026/Aug/8/auto-mode/ 、https://github.com/froggugugugu/project-blueprints

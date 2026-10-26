# allowの規則は残し、ガードのポリシーのpermitから生成する

Status: accepted — allowは分類器の前段で決定的に効き、autoモードも狭いallowを残す設計で、分類器は自社評価で見逃し17%、allowを消した実践例は無い（2026-09-22）

rule: Generate permissions.allow from guard-rules.json's permit rules via to-claude-permissions.ts, not the old 71-entry config, and never write broad allow forms (Bash(*), whole interpreters, package-manager run); always permit git commit, git push on feature branches only (never main), and test commands (npm test, go test, pytest, bun test).
scope: repo

## Problem

Claude Codeの`permissions.allow`（71本、旧設定の層から生成）を、autoモード（分類器）とjigのガードがある前提で、全部消すか、残すか、別の元から生成するか。

## Decision

- allowは残す。元は旧設定の71本ではなく、`guard-rules.json`のpermitの規則。`to-claude-permissions.ts`がpermitを`Bash(<prefix> *)` / `Write(<glob>)` / `Edit(<glob>)`に、forbidをdenyに翻訳し、翻訳できないもの（複雑な正規表現、net.fetch、mcp.call）は`hookOnly`として明示する。
- 広い形（`Bash(*)`、インタプリタ丸ごと、パッケージマネージャのrun）は書かない。autoモードが落とすものは最初から出さない。
- 本当の強制はjigのフック（PreToolUseのdenyはbypassでも効く）。nativeのdenyはその後ろ盾。
- 既定のpermitとして最初から入れる三種: `git commit`、`git push`（featureブランチ。mainへのpushはforbidのまま）、テストの実行（`npm test`、`go test`、`pytest`、`bun test`）。分類器のサービス停止時に作業が止まらないための保険。
- 旧設定の71本は移行時に一本ずつ見る。狭くて日常的なもの（gitの副コマンド、`npm run *`の個別、formatter）はpermitに移し、`Edit(./**)`のような広いもの（autoの第2段が自動承認する）は捨てる。

## Alternatives considered

- **allowを全部消し、deny + フック + 分類器に任せる**: 当初の案。Claude Codeの判定順序は「1. allow/ask/denyに一致する操作は即決 → 2. 読み取りと作業ディレクトリ内の編集は自動承認 → 3. それ以外が分類器」で、autoモードに入るときに落とされるのは広いallowだけ、「`Bash(npm test)`のような狭い規則は残る」と明記。Anthropicの設計文書も第一層を「組み込みの安全ツール一覧とユーザーの設定」とし「狭い規則は引き継ぐ」と書く。分類器は自社評価で実データの「やりすぎ」操作52件に対し見逃し17%（「the honest number」）、合成の持ち出し1,000件で5.7%、毎回Sonnet 5への往復が入る。allowに書いた操作を分類器が拒否する報告が2026-07から09-22まで5件以上（#95996、#83611、#88575、#85491、#76149）、denyがautoで無効化された報告（#88770）、分類器の停止で作業が15分止まった報告（#91517）。「autoがあるからallowは不要」と述べた文書・記事はベンダーにも実践者にも無く、唯一の直接の実践例は「分類器に繰り返し拒否される正当な操作はallowに足す」と逆の運用。却下。
- **旧設定の71本をそのまま持ち越す**: 元が旧設定の層（`permissions.yaml`のcore/packs/personal）で、`2026-09-22-config-layout-no-personal-layer.md`に反する。広い形（`Edit(./**)`、`WebFetch(domain:*)`）も含む。却下。

## Consequences

- 生成器のClaude Code向けの出力に`permissions.allow`と`permissions.deny`が入り、どちらも`guard-rules.json`から派生する。二重管理は無い。
- `dontAsk`モード（allowに一致するものだけ動かす）が使える状態を保つ。
- 日常操作（`git commit`など）に対する分類器の精度は誰も測っていない。17% は「やりすぎ」操作のhard caseの数字で、そのまま当てはめない。
- Codexには分類器もper-commandのallowも無く（sandboxのprofile方式）、この決定はClaude Codeに固有。pi・omp・DSHの権限モデルは未調査。

## Sources

- 判定順序とautoモード: https://code.claude.com/docs/en/permission-modes.md 、規則: https://code.claude.com/docs/en/permissions.md
- 分類器の評価: https://www.anthropic.com/engineering/claude-code-auto-mode
- issue: https://github.com/anthropics/claude-code/issues/88770 、/95996 、/91517 、/83611 、/88575 、/85491 、/76149
- 実践者: https://simonwillison.net/2026/Aug/8/auto-mode/ 、https://github.com/froggugugugu/project-blueprints

# Go 並行・性能エキスパート エージェント群 — 設計

grilling（2026-08-26〜27、4 ラウンド 15 問）で詰めた結果。実装はこの記録を正本にする。

## 背景

- LLM は goroutine / channel / sync の深い判断（memory model、lock 競合、Pool の適否）と、Go 1.26 / 1.27 の API を知らない
- 既存の `packs/go` には go-reviewer（並行の正しさ + idiom）と go-modern（1.26 までの idiom 表）しか無く、pprof / GC / PGO / atomic への言及がゼロ
- 最新 Go は 1.27.0（2026-08-19）。サポートは 1.26 / 1.27。手元は 1.25.5（EOL）

## 決定記録

### 決まったこと

**構成**
- skill 2 本（`go-concurrency` / `go-performance`）+ agent 2 本（`go-perf-reviewer` / `go-version-scout`）+ workflow 1 本（`go-optimize`）に分業する — 重視したトレードオフ: 初期工数より、Go の版ごとに知識だけ差し替えられる構造
- すべて `packs/go/` 配下に置く（`agents/ skills/ hooks/ workflows/`）。`pack disable` で丸ごと消える — 重視: Go を使わないマシンに Go の hook を残さない
- skill は判断先行: SKILL.md 本文 = 決定表（channel / mutex / atomic、いつ測るか）+ 手順 + 「どちらの agent が見るか」。カタログ・落とし穴・出典は `references/` — 重視: 網羅の見えやすさより、agent が最初に判断基準を得ること
- golang-patterns の `## Concurrency Patterns`（175-298 行）と `## Memory and Performance`（495-570 行）は新 skill へのポインタ数行に置換。他節は無傷 — 重視: 既存 skill の温存より、同じ話題の情報源を 1 つにすること

**責務境界**
- go-reviewer = 並行の正しさ（race / leak / deadlock）+ idiom / error wrap。go-concurrency skill を読んで深める
- go-perf-reviewer = 性能全般。lock 競合・mutex vs atomic も「測って分かる」側なのでこちら — 重視: 話題のまとまりより、指摘の重み（正しさ = Block、速さ = Warn）と agent の一致
- 境界例は go-concurrency skill に「どちらが見るか」の 1 行を書いて吸収

**決定的ツールと LLM の境界**
- 軽い検査は hook、重い測定は agent — 重視: 二重管理の手間より、race / leak を混入時点で止めること
- hook `go-guard`（`packs/go/hooks/`）: PostToolUse（.go の Edit / Write）で `go vet` + `staticcheck` を編集した package に限定して実行、Stop で `go test -race`（profile `strict` のみ）。出力は既存 `post-edit-typecheck.js` と同じく問題がある時だけ stderr に最大 10 行（問題なし = 0 token）。道具が無いマシンでは警告 1 行で素通り — 重視: 編集ごとの数秒より、並行の誤用（staticcheck SA2xxx）を編集直後に出すこと
- 道具の導入: `golangci-lint` / `govulncheck` は `domains/dev/packages/homebrew.nix` に追加。`benchstat` と（1.25 以前向け）`modernize` は `go run …@latest` で呼び、インストールしない
- 古い idiom の書き換えは `go fix ./...`（1.26+）を LLM の前に回す。LLM が残るのは log→slog、rand v2、os.Root、tool directive など意味的移行のみ

**Go 最新版への追従**
- go-modern の表は「なぜその書き方か」の手引き。API の存在と since は `go doc <pkg>.<Symbol>` で実行時に確認し、記憶で書かない
- 版は 3 値を分離して扱う: go.mod の `go` / `toolchain`（対象の下限）、`go env GOVERSION`（手元）、`go.dev/dl/?mode=json`（最新）
- go-version-scout はリリース時に release notes を読み、go-modern と `references/` の差分 draft を書く。適用は人が見る
- 起動は SessionStart hook: 前回確認から 7 日過ぎていれば dl JSON を 1 回引き、新版があれば 1 行知らせる。scout 本体は人がその通知を見て呼ぶ — 重視: 完全自動より、PC の前提を持たずに「Go を書く時」に必ず気付くこと

**性能の証拠**
- go-perf-reviewer は静的で全て指摘し、「測れば白黒つく」主張だけ benchstat / pprof で測る。残りは「未検証」と明記 — 重視: 所要時間より、自信ありげな誤りを出さないこと
- `/review` では go-perf-reviewer を静的モードで呼ぶ。測定は go-optimize の仕事

**go-optimize workflow**
- 入力: `args = { pkg, bench, threshold (既定 5%), budget }`。bench が無い package では「ベンチを書く」提案 1 本で終了
- 流れ: pprof で hot spot 特定 → 提案（3〜5 本、`isolation: 'worktree'` で並列）→ 正当性ゲート（`-race` + test 緑）→ 性能ゲート（benchstat `-count≥10`、p < 0.05 かつ改善 ≥ threshold）→ 機構の確認（pprof diff で狙った関数が減ったか）→ verifier（提案者と別コンテキスト、hot path でない / 可読性に見合わない案を却下、理由を記録）→ 配達（既定 draft、commit しない） — 重視: 人の判断機会より、配達物の少なさと却下理由の記録

**/review への配線**
- `review.js` の汎用 `performance` 次元に「言語別 agentType を選ぶ口」を足し、Go の diff では go-perf-reviewer（静的モード）に差し替える。他言語は現状のまま — 重視: review.js の形の温存より、Go の diff で性能の指摘源を 1 つにすること

### 検討して却下した案
- go-reviewer 1 本を強化する — go-reviewer が自ら責務を Go 固有に絞っており（`go-reviewer.md:12`）、性能の方法論を足すと本文が数百行になり sonnet の 1 コンテキストで薄まる
- golang-patterns を新 skill に吸収して廃止 — ECC 由来 skill の解体になり、過去の方針（分割ダイエット不要）に反する
- 3 agent（go-concurrency-reviewer を独立） — /review の Go レーンが 3 本になり VERIFY_CAP=12 を 3 倍消費
- hook を `core/hooks/` に置く — Go を使わないマシンにも Go の hook が登録される
- `LANG_REVIEWERS` を配列化して Go に 2 agent — 汎用 performance レーンと重複し verify 上限を食い合う
- scout を手元 cron で起動 — PC が起きている前提で運用が回らない（ユーザー指摘で取り下げ）
- scout をクラウド routine（`schedule`）で起動 — クラウドから dotfiles へ書く配管（認証・PR）が本体より大きい。複数人運用になったら再検討
- go-optimize の受理を統計 + 閾値のみにする — 偶然速くなった変更や可読性を落とすだけの変更が通る
- 全検査をターン終了にまとめる — どの編集が原因か分からなくなる

### 未決・前提
- go-optimize の閾値（既定 5%）と verifier の却下率は運用で見る。却下が多すぎれば verifier を「flag のみ、人が最終判定」に緩める
- `-race` が strict でも重すぎる package では hook 側で `-run` を編集した package に絞る
- staticcheck が 5 秒を超える package は PostToolUse から外し、Stop に落とす
- `references/` が 1 ファイル 500 行を超えたら話題ごとに分割する
- 手元の go を 1.27 に上げる（1.25.5 は EOL）。上げないと `go fix` の modernizer と `goroutineleak` profile が使えない
- 調査カタログ（並行 749 行 / 性能 1027 行 / 版 420 行 / 先行事例 497 行）はセッション scratchpad ごと消失。`references/` を書く段階で出典 URL から再取得する

### 推奨アプローチ
1. 手元の go を 1.27 へ。`homebrew.nix` に golangci-lint / govulncheck を追加
2. `go-concurrency` / `go-performance` skill（本文 + `references/`、`metadata.verified: 2026-08`）。golang-patterns の 2 節をポインタ化
3. `go-perf-reviewer` agent（静的 / 測定の 2 モード、証拠鎖の 5 段、「確認済 / 未検証」の 2 区分）
4. `go-guard` hook（PostToolUse: vet + staticcheck、Stop: -race strict）と SessionStart の版確認 hook。`core/settings.layer.json` 相当の登録は pack 側から
5. `go-version-scout` agent（3 値分離、`go doc` 確認、差分 draft）。go-modern に 1.27 を追記
6. `review.js` の performance 次元に言語別 agentType の口を足し、Go で go-perf-reviewer を選ぶ
7. `go-optimize` workflow（`packs/go/workflows/`）。yoki-switch が pack の `workflows/` を合成することは確認済み

### 出典
- https://go.dev/doc/go1.26 / https://go.dev/doc/go1.27 / https://go.dev/dl/?mode=json / https://go.dev/doc/devel/release
- https://pkg.go.dev/cmd/vet / https://staticcheck.dev/docs/checks/#SA2000 / https://go.dev/doc/articles/race_detector
- https://pkg.go.dev/golang.org/x/perf/cmd/benchstat / https://go.dev/blog/testing-b-loop / https://go.dev/blog/pprof / https://go.dev/blog/pgo
- https://go.dev/ref/mod#go-run
- https://github.com/samber/cc-skills-golang（skill 分割・modernize 併用の先行例。設計の参考であり流用はしない）
- `packs/go/agents/go-reviewer.md:12,61-65` / `packs/go/skills/golang-patterns/SKILL.md:175-298,495-570` / `packs/go/skills/go-modern/SKILL.md:5,12`
- `core/workflows/review.js:28,60,112-135,184` / `core/settings.layer.json:183-200` / `runtime/yoki/scripts/hooks/post-edit-typecheck.js:55-96` / `domains/dev/bin/yoki-switch:109` / `domains/dev/packages/homebrew.nix:7`

### 次のステップ
- 上の「推奨アプローチ」の順に実装する。1 と 2 は並行可
- 実装前に go-optimize の閾値と budget の既定値を `args` の説明に書く

### 元ラウンド
`.claude/.cache/grilling/go-perf-concurrency-agents/transcript.md`

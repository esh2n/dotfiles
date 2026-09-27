# Kimi Code 型の Swarm を、この家の pi・omp でどう持つか

日付: 2026-09-27。問い: 持ち主が 09-13 から求めている Swarm（親が仕事を分け、裏で複数の作業役が動き、kubectl 風の一覧で見える。発端は @voidwarriorchan の自作、参考は Kimi Code）を、pi・omp と LiteLLM の tier の上でどう作るか。要否は問わない（持ち主の要件）。

三つの担当の記録: [kimi-code.md](2026-09-27-swarm/kimi-code.md)（Kimi Code の Swarm をコードで読む）、[references.md](2026-09-27-swarm/references.md)（発端の投稿、OpenAI Agents SDK、Claude Code agent teams、pi-agent-teams）、[fit-omp-pi.md](2026-09-27-swarm/fit-omp-pi.md)（載せる側: omp・pi・llama-server・LiteLLM・herdr と、09-13 の作業の残り）。

## 分かったこと

- **omp は Swarm の一覧画面をもう持っている。** Agent Hub（`Alt+A` / `Ctrl+S`）が、作業役ごとに状態（running / idle / parked / aborted）、親、モデルの役割と解決後のモデル、担当の仕事、費用、経過時間、リクエスト数、ツール呼び出し数、トークン数を並べ、実行中の作業役への指示・再開・停止もできる。子は同期の task と、裏に切り離した起動の両方で並行に動く（https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md 、2026-09-27 に直接確認）。09-22 の調査はこれを拾っていない。
- **pi 本体に Swarm は無い。** 画面は拡張の `ctx.ui.setWidget` で出せる。拡張の pi-agent-teams は 2026-06-12 からコミットが無く、親のタイマーが pi ごと落とす issue #50 が放置、1 か月で 1,195 セッション・2.2GB の worktree が溜まる issue #9 の修正 PR も 5 か月未マージ（references.md）。
- **Kimi Code の Swarm** は子ごとにモデルを選べ、OpenAI 互換の任意の窓口で動くとベンダー文書にある。ただし 09-13 に良いと読んだ点に誤りがあった: Ctrl+C で CLI ごと落ちる（0.43.1 で修正）、再起動後に作業役の一覧が戻らない（PR #3970、09-23 修正）。弱点を埋める試験機能 Tower（作業役間の連絡、worktree 分離、レビュー付き合流）は既定 off で、一覧画面は無い（kimi-code.md）。
- **09-13 の自作（graph-ideal）は残っている。** pi の下に出るウィジェットと一覧画面まで作ってあったが、09-22 の「独自の実行エンジンは作らない」を理由に 09-23 の `68b80d76` で main から外した。ブランチ `feat/graph-ideal-form` に現存（fit-omp-pi.md）。
- **GPU サーバー（1 スロット）への同時リクエストは、llama-server が待たせる**（二次情報、未確定）。LiteLLM の `max_parallel_requests` は超過を待たせず即 429 にするので、掛けると逆効果になりうる。今の `config.yaml` はどちらも未設定（fit-omp-pi.md）。
- **発端の投稿は見つからなかった。** 09-13 に控えた URL は別の投稿で、本文の投稿群は fxtwitter と検索では辿れなかった。herdr の上で Swarm を組む別人の公開実装は 2 件（★0〜2）あるだけ（references.md）。

## 否定側

- 自動のマルチエージェントは CoT の多数決より弱く、最大 10 倍高い（arXiv 2606.13003、推論・検索課題でコーディングではない）。Shopify は「早いうちはマルチエージェントを避けよ」。Claude Code の agent teams は既定 off の試験機能で、トークンは作業役の数に比例（references.md）。これらは作り方の制約（費用を一覧で見せる、作業役の数に上限）として扱う。

## 確認できなかったこと

各記録の末尾を参照。主なもの: omp の CHANGELOG（18.0.4 → 18.3.4 の差分）、omp の子に LiteLLM の tier 名を渡して Agent Hub が正しく費用を出すか、llama-server の待ち行列の一次資料、@voidwarriorchan の投稿本文。

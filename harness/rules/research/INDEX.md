# 調査記録 索引（フロー）

このディレクトリの調査記録はフローで、名前の日付から 14 日で knowledge か決定記録へ昇格するか、消える（`../decisions/2026-09-27-records-flow-and-stock.md`）。確立した事実は `../knowledge/INDEX.md` にある。**調べる前に両方の索引を読む。確立済みの事実は再調査しない。**

一行一記録、`[問い](ファイル) — 結論一行 (日付)`。決定そのものは `../decisions/` にある。

- [Windows と同じ NVMe を分けて Omarchy を入れ直せるか、2 本目の NVMe を足す場合との違い](2026-09-30-omarchy-same-disk-vs-second-nvme.md) — 同一ディスクの free-space install は #7867（Windows の ESP を使わず新しく作る、`omarchy-refresh-limine` が Windows の項目を消す）が 09-30 も未修正で修正 PR も未マージ、#7515（空き領域の隣にパーティションがあると失敗）も open。Windows 先行の同一 NVMe に後から同居させた一次報告は無し。Z690-P は M.2 が 3 本。sbctl は `import-keys` で鍵を持ち越せる (2026-09-30)
- [一枚の RTX 3090 Ti で llama-server の Qwen と 3D モデル生成 AI をどう切り替えるか](2026-09-30-one-gpu-llm-and-3d-generation.md) — 同時には載らない（Hunyuan3D-2.1 は形状+テクスチャで 29GB、TRELLIS.2 は 24GB 以上、Qwen は 17.4GB）。llama-server の `--sleep-idle-seconds` は子が ~600MiB を握ったまま（#19379）で、完全に空けるには `/models/unload`。llama-swap は ComfyUI を公式に扱い `exclusive` グループで排他できるが、LLM と ComfyUI を一つの排他グループにした設定例も、一枚の GPU で切り替えて使っている実践報告も見つからない (2026-09-30)
- [家の LLM の利用料を見て GPU の用途を切り替えられる、tailnet の中だけの画面と操作口はどう作られているか](2026-09-30-home-llm-control-page.md) — LiteLLM の管理画面は DB 必須、モデル別・キー別の日次利用（`/user/daily/activity`）と個別ログは OSS、チーム別の集計レポートは Enterprise。複数機械を一つの DB に集めた場合に合算表示するかは記述なし。tailscale serve は ID ヘッダを付けて偽物を除くが、検査はバックエンドの責任で、バックエンドはループバックで待つこと。利用料と切り替えを一つの画面にした公開例はゼロ（あるのは読むだけの画面と CLI の切り替え、どちらも ★0） (2026-09-30)

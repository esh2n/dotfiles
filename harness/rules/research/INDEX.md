# 調査記録 索引（フロー）

このディレクトリの調査記録はフローで、名前の日付から 14 日で knowledge か決定記録へ昇格するか、消える（`../decisions/2026-09-27-records-flow-and-stock.md`）。確立した事実は `../knowledge/INDEX.md` にある。**調べる前に両方の索引を読む。確立済みの事実は再調査しない。**

一行一記録、`[問い](ファイル) — 結論一行 (日付)`。決定そのものは `../decisions/` にある。

- [Windows と同じ NVMe を分けて Omarchy を入れ直せるか、2 本目の NVMe を足す場合との違い](2026-09-30-omarchy-same-disk-vs-second-nvme.md) — 同一ディスクの free-space install は #7867（Windows の ESP を使わず新しく作る、`omarchy-refresh-limine` が Windows の項目を消す）が 09-30 も未修正で修正 PR も未マージ、#7515（空き領域の隣にパーティションがあると失敗）も open。Windows 先行の同一 NVMe に後から同居させた一次報告は無し。Z690-P は M.2 が 3 本。sbctl は `import-keys` で鍵を持ち越せる (2026-09-30)

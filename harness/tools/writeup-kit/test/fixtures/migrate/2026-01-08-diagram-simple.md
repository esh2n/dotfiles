---
title: 図テスト（小規模）
summary: diagram directive が正しく IR に変換され描画に成功することを確認する。
date: 2026-01-08
tags: [test]
---

## 対象セクション

:::diagram{direction=horizontal}
zone z1[ゾーン1]
  a[ノードA]
  b[ノードB]
end
a -> b : "エッジ"
:::

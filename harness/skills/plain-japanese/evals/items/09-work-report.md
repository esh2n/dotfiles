---
id: "09"
category: ja-chat
reader: 作業を頼んだが途中経過を見ていない持ち主
task: plain-japanese skill を作った作業の報告を書く。
traps: [家, 床, 配線]
must_keep: [skill, terms.tsv, uv]
---

## 事実

1. harness/skills/plain-japanese/ を新しく作った。natural-japanese の上に載せる skill で、natural-japanese は編集していない。
2. 検査スクリプトは 4 つ: 用語、比喩、圧縮表現、書き直しの差分。どれも Python の標準ライブラリだけで動き、ファイルか標準入力を受け取る。
3. 用語の表 terms.tsv は 33 行で、分類は keep・keep+gloss・replace・avoid の 4 つ。
4. 比喩の語の一覧のうち yomiyasu から取った行は、出典とコミットと MIT ライセンスの表示を NOTICE.md に記録した。
5. スクリプトのテストは 71 件すべて通った。
6. 常に適用される規則を rules/common に 1 ファイル足し、決定メモを 1 本書いた。

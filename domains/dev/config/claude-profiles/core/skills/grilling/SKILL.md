---
name: grilling
description: Relentless design interview that grills a plan, spec, or decision until you and the user reach shared understanding. Use when the user types /grilling, says "grill me", "詰めて", "深掘りして", "設計を詰めたい", "プランの穴を突いて", "この判断をストレステストして", or hands over a draft design and asks what is missing. Asks only decisions that carry a real trade-off — facts that code, config, or docs can answer are investigated by subagents instead of being asked. Every question ships with concrete options, what each option gains and loses, a recommendation naming the trade-off it prioritizes, and verified sources. Writes a decision record to the file given by --out.
---

# grilling

対象: $ARGUMENTS

## 1. 目的

plan / design / decision を、共通理解に達するまで詰める。

ユーザーが「共通理解に達した」と明示的に確認するまで、実装にも計画作成にも移らない。
中途半端な合意で先へ進むのがこのスキルの唯一の失敗モード。

## 2. 入力

- **対象** — テキストまたはファイルパス。省略時は直前の会話で扱っていた設計を対象にする。
- `--out <path>` — 決定記録の書き出し先。sdd の `spec/requirements.md`、プロダクト独自 SDD の任意の md、または省略（＝チャットにのみ出す）。
- `--hints "..."` — 呼び出し元スキルが渡す観点。frontier の初期シードとして使う。

## 3. 設計ツリーと frontier

対象を**判断の木**として保持する。ノード = 決めるべきこと、辺 = 「A を決めないと B は決められない」。

- **frontier** = 前提がすべて解決済みで、まだ決まっていないノード。次に出す問いは必ず frontier から選ぶ。
- 回答を受けたらノードを `decided` にし、その回答が生んだ新しい未決ノードを子として木に足す。
- **深さ優先**。1本の枝を洞察が尽きるまで掘ってから隣の枝へ移る。話題を跳ね回らない。
- 木は毎ラウンドのラウンド文書に記録する（§8）。

## 4. 事実は聞かず調べる

コード・環境・設定・ドキュメントを読めば分かることは**ユーザーに聞かない**。

- 調査はサブエージェント（`Explore` または `general-purpose`、model は sonnet）に投げる。複数の疑問は1回でまとめて並列に投げる。
- 調査中の事実に依存する問いは frontier から一旦外し、結果が返ってから出す。
- ユーザーに聞くのは**選択・トレードオフを伴う意思決定のみ**。「どうしますか」ではなく「A と B のどちらを失いますか」。
- 甘い回答・曖昧な回答には突っ込む。「それはどちらの意味ですか」「その前提が崩れたら何が壊れますか」「その数字の出どころは」。同意して次へ行かない。

## 5. 出典の扱い

- 推奨の根拠に外部文献（公式ドキュメント・論文・権威ある設計ガイド）を引くときは、sonnet サブエージェントに WebFetch させ、**URL が実在し、該当箇所が主張どおりであること**を確認してから引用する。
- 確認できなかった出典は書かない。記憶からの引用は出典ではない。
- repo 内の根拠は `path:line` で示す。行番号まで書く。

## 6. チャネル

問いをどこに出すか。**1ラウンド = 1ページ**（frontier の問い **3〜6問**）を出すのが
`local` と `artifact`。どちらもメインセッションが書くのは**ラウンド文書だけ**で、
HTML の生成は **sonnet サブエージェント**に投げる。手で HTML や SVG を書かない。

会社の痕跡（社内ドメインの remote、社内 org、社内ツール名、社内語）が見つかれば
`chat`。判断がつかなければ**一度だけ聞く**。

### local（既定。ブラウザがあるマシンならこれ）

サブエージェントに
`node <skill>/render/render.mjs serve <round.md>` を走らせる。ページが開き、
**全問の提出まで戻らない**。戻り値の要約（`q1: A — …`）をそのまま `answer:` 行に写す。
回答は `<round.md と同じディレクトリ>/answers.jsonl` にも残る（最後の行が勝つ）。

### artifact（共有したい・別端末で答えたい・ユーザーが指定したとき）

- `render.mjs <round.md> --fragment -o <scratchpad>/round-<n>.html` を走らせ、
  返ってきたパスを Artifact ツールに渡す。
- **毎ラウンド同じファイルパスを渡す**ことで URL を保つ（1 slug = 1 artifact）。
  `capabilities: {artifact: {}}` を付け、入力が保存されセッションに通知が来るようにする。
- 回答の回収は artifact の再読込（`action: "read"`）。各 `.answer` の `data-choice` と
  `textarea` の値を取り出し、ラウンド文書に `answer:` 行として書き戻す。
- 全問に回答が付いたら次のラウンドへ。同じ artifact を上書きする。

### chat（フォールバック）

§7 の形式で**1問ずつ**出し、回答を待つ。ページは作らない。

## 7. 1問の形式（チャット）

必ずこの Markdown を使う。**AskUserQuestion は使わない**（選択肢ごとの理由を並べ、自由記述の回答も許すため）。

```
### ❓ Q[n]: [質問]
**なぜ今この判断か** — 1〜2行
**抽象** — 何を決める問いか（1行）／ **具体** — 実コード・実ファイルの引用 `path:line`
- **A** — 選択肢 — 得るもの／失うもの
- **B** — …
**推奨: [A]** — 重視したトレードオフ: …。根拠: [出典 or path:line]
```

チャットに出す1問は **25 行以内**。選択肢は 2〜4 個。

## 8. ラウンド文書

チャネルによらず、問いを出すのと**同時に**同じ内容を
`.claude/.cache/grilling/<slug>/round-<n>.md` に書く。

- `<slug>` は対象から作る英小文字ケバブケース。ディレクトリが無ければ作る。
- プロジェクト外（git repo でない場所）で動かす場合は scratchpad 配下に書く。
- 形式は `references/round-format.md` に従う。散文と機械可読 YAML ブロックの**両方**を書き、内容を一致させる。
- ラウンド文書は問いのほかに **`## 前提`（そのラウンドの文脈）** と、問いごとの
  **```diagram ブロック** も持つ。どちらも描画面（`render/`）がそのまま図とパネルにする。
- **構造を比べる問いには図を描く**。どの部品がどこに載るか、どの経路が変わるか——
  位置や経路が争点なら描く。それ以外は「**一文で言えるならその一文を書く**」。
- ユーザーの回答は同じファイルに `answer:` として追記し、`status` を `answered` にする。
- **リポジトリにはコミットしない**。対象プロジェクトの `.gitignore` に `.claude/.cache/` が
  含まれているか確認し、含まれていなければ追記するかユーザーに知らせる。

## 9. 記録の寿命

- **HTML** — scratchpad に出す。**残さない**（`serve` はファイルに書かず配るだけ）。
- **ラウンド文書 / `answers.jsonl`** — `.claude/.cache/grilling/<slug>/`。
  grilling をしているあいだだけ。`answers.jsonl` は `answer:` 行に写したら用済み。
- **決定記録を書いた時点で**、そのラウンドを順に連結して同じディレクトリの
  `transcript.md` にまとめ、`round-<n>.md` は削除する。決定記録の「元ラウンド」は
  `transcript.md` を指す。
- **スキル開始時**に、`.claude/.cache/grilling/` 直下の slug ディレクトリのうち
  mtime が 60 日より古いものを消し、消したことを**1行で**言う。

  ```sh
  find .claude/.cache/grilling -mindepth 1 -maxdepth 1 -type d -mtime +60 -exec rm -rf {} +
  ```

## 10. 終了

frontier が空になり、重要な枝に暗黙の前提が残っていないことを確認したうえで、
「共通理解に達しましたか」と聞く。

- 続行を求められたら、指摘された箇所をノードとして木に足し、深掘りを再開する。
- 「もう十分」と言われても、未決の前提が残っていればそれを1行で列挙してから終える。

## 11. まとめフェーズ

1. 2〜3案が並立したまま残っていたら、**比較表**を提示する（列: 案 / 得るもの / 失うもの / 向く状況）。
2. 決定記録を **200〜300 字ごとの節**に区切り、順に提示する。各節の末尾で「ここまで合っていますか」と確認を取る。
3. 食い違いが出たら §3 の木に戻り、その枝を掘り直す。

## 12. 決定記録の形式

`--out` のファイルに書く。既存ファイルに `## 決定記録` があれば更新、無ければ末尾に追記する。

```markdown
## 決定記録
### 決まったこと
- [決定] — 重視したトレードオフ: [1行]
### 検討して却下した案
- [案] — 却下理由
### 未決・前提
- [残っている前提と、それが崩れたときの影響]
### 推奨アプローチ
### 出典
- [URL or path:line]
### 次のステップ
### 元ラウンド
`.claude/.cache/grilling/<slug>/transcript.md`
```

**ADR 昇格の基準**: 戻しにくい／自明でない／本物のトレードオフがある——この3つを**すべて**満たす決定のときだけ、別途 ADR の作成を提案する（勝手に書かない）。

## 13. 他スキルからの利用

`grilling <対象> --out <path> --hints "..."` を呼ぶだけでよい。

例（sdd clarify）:

```
grilling "spec/requirements.md の要件" --out spec/requirements.md \
  --hints "入出力の形式 / エッジケース / 非機能要件 / 既存コードとの統合点 / スコープ境界"
```

呼び出し元は、grilling が「共通理解に達した」と報告してから次のフェーズへ進む。

## 参考

- `references/round-format.md` — ラウンド文書の形式（機械可読な正本）
- `render/README.md` — ラウンド文書を1ページの HTML にする描画面
- Matt Pocock, `grilling` skill — https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling
- ryonakae, `dig` skill — https://github.com/ryonakae/dotfiles/blob/master/config/.agents/skills/dig/SKILL.md

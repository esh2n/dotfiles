---
name: dopa-shorts
description: "文章(記事・ドキュメント・ニュース)を縦ショート動画(9:16 mp4)に変換する。ずんだもん解説風の立ち絵テンプレとキネティックタイポテンプレ、VOICEVOX/CoeFont/sayのボイス切替対応。「この記事をショート動画にして」「ずんだもん解説にして」「縦動画にして」で使う。個人・内輪視聴用。"
---

# dopa-shorts — 文章→縦ショート動画

長文を読めない人(通称ドパガキ)向けに、文章をテンポの速い縦動画mp4に変換する。
パイプライン: ①台本JSON生成(Claude) → ②TTS音声生成 → ③Remotionレンダリング。

- skill本体: この`SKILL.md`(台本生成の文法)と `video/`(レンダラー)
- 台本スキーマの正: `video/src/schema.ts`(zod)

## Prerequisites

- `video/` で `pnpm install && pnpm bootstrap` 済みであること(未実行ならまず実行)
  (`pnpm setup` と打たないこと — pnpm本体の予約コマンドでシェル設定を書き換えてしまう)
- ボイスに `voicevox` を使う場合: VOICEVOXアプリが起動していること(`open -a VOICEVOX`)
- `coefont`(ひろゆき等): 環境変数 `COEFONT_ACCESS_KEY` / `COEFONT_CLIENT_SECRET` / `COEFONT_VOICE_<NAME>`
- どちらも無ければ `say`(macOS標準TTS)で動く

## ワークフロー

1. ユーザーから文章(またはURL)を受け取る
2. 下の「ドパガキ文法」に従って台本JSONを作り、**必ず一度ユーザーに提示して承認を得る**
   (元記事に対する事実誤りはこの段階でしか直せない)
3. 台本を`<slug>.json`として保存し、音声生成:
   `cd video && pnpm voice <path/to/script.json>`
4. ドラフト確認: `pnpm render <path/to/script.json> --draft` → 出来た`out/<slug>.draft.mp4`をユーザーに確認してもらう
5. 本レンダリング: `pnpm render <path/to/script.json>` → `out/<slug>.mp4`

台本を修正したら `pnpm voice ... --force` で音声を作り直すこと(カット数不一致はrenderが検知して止まる)。
VOICEVOXなしで見た目だけ確認する場合は `pnpm render ... --no-voice`。

## 台本JSONフォーマット

`examples/sample-script.json` が正しい実例。スキーマの正は `video/src/schema.ts`。

```jsonc
{
  "meta": {
    "title": "...",
    "slug": "kebab-case",        // 出力ファイル名になる
    "style": "zunda",            // zunda(立ち絵解説) | kinetic(文字だけで殴る)
    "voice": "zundamon",         // zundamon | metan | tsumugi | ... (coefontならUUID/名前)
    "adapter": "voicevox",       // voicevox | coefont | say
    "speed": 1.15,               // 話速。1.15がドパガキ標準
    "bgm": null                  // public/bgm/のファイル名 or null
  },
  "cuts": [
    {
      "type": "hook",            // hook | body | punch(オチ)
      "text": "セリフ全文なのだ",       // 字幕表示 + TTS入力(readingが無い場合)
      "reading": "セリフぜんぶんなのだ", // TTS用よみ(任意)。英語・専門用語がある時だけ
      "telop": "画面のでか文字🔥",  // 3〜10文字目安
      "emotion": "surprised",    // normal|happy|surprised|thinking|sad|angry
      "se": "don",               // don|pop|shakin|whoosh (public/se/*.wav)
      "visual": { "kind": "text", "text": "図解" },  // または {"kind":"image","src":"content/x.png"}
      "pauseAfterSec": 0.8       // 「間」の明示指定(通常は省略)
    }
  ]
}
```

尺は音声長から自動決定される。**台本に秒数を書かない・考えない**こと。

## ドパガキ文法(台本生成ルール)

文章から台本を作るときは、原文の論理構造を捨てて以下の型に再構成する:

1. **冒頭1秒フック(先頭カット、type: hook)**: 結論の逆張り・疑問形・数字で始める。
   「実は」「〜するな」「99%が知らない」型。原文の導入部は絶対に使わない
2. **1カット=1情報、セリフは25〜45文字**(読み上げ3〜5秒)。60秒なら12〜18カット。
   「驚き→理由→例→オチ」の順に並べ直す
3. **telopは体言止め、3〜10文字、絵文字1個まで**。漢字4連続以上禁止。
   セリフの要約ではなく「一番強い言葉」を抜く
4. **5カットごとに緩急**: SE付きツッコミを入れるか、`pauseAfterSec: 0.5`前後の間を置く。
   全カット最高速は逆効果
5. **最終カット(type: punch)はオチかループ誘導**: 冒頭フックに回収させると強い
6. **情報忠実度**: 嘘・捏造は禁止。単純化はOK。数字と固有名詞は原文通りに
7. **語尾はボイスに合わせる**: zundamon=「〜なのだ」、metan=です・ます、
   ひろゆき系=「〜ですよね」「それってあなたの感想ですよね」的な軽い煽り
8. **英語・略語・専門用語を含むカットには必ず`reading`を付ける**: TTSは英語を
   読み間違える(例: OAuth2)。`text`はそのまま、`reading`に全文のカタカナ・ひらがな
   よみを書く。読み方が自明でない固有名詞はユーザーに確認する

台本を書いたらセリフ合計文字数×0.13秒で概算尺を出し、目標(45〜75秒)からズレていたらカットを増減する。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `VOICEVOX に接続できません` | `open -a VOICEVOX`。未導入なら https://voicevox.hiroshiba.jp/ |
| 立ち絵が404 | `pnpm bootstrap` で立ち絵をDL(zunda styleのみ必要。kineticなら不要) |
| CoeFont認証エラー | 環境変数を確認。急ぐなら `meta.adapter: "voicevox"` に切替 |
| manifestカット数不一致 | 台本変更後に `pnpm voice <script> --force` |
| レンダリングが遅い | まず `--draft` で確認してから本番を回す |
| BGMファイルがない | `video/public/bgm/` にmp3を置く(DOVA-SYNDROME等)か `bgm: null` |

## 権利メモ(個人・内輪視聴前提)

- ずんだもん等の立ち絵・音声はVOICEVOX/各キャラクターの利用規約に従う
- SEはプレースホルダー合成音。品質を上げるなら効果音ラボ等から手動差し替え
- BGM・ミーム素材は自動取得しない。ユーザーが用意したものだけを使う

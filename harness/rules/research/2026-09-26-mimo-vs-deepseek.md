---
question: "Xiaomi の MiMo（2026-09 時点）は、この家の LiteLLM の三つの tier — main（deepseek-flash）、complex（deepseek-v4-pro）、deterministic（計画の実行役、3090 Ti の Qwen3.8-27B）— で DeepSeek と比べてどうか。"
date: 2026-09-26
verdict: "最新は MiMo-V2.6（2026-09-21/22、MIT）: Pro は 1.02T 総 / 42B 活性、Flash は 309B / 15B、どちらも 1M 文脈、API は OpenAI 互換で LiteLLM に `xiaomi_mimo/` で day-0 対応。独立測定（Artificial Analysis）では V2.6-Pro の知能指数 46 が DeepSeek の現行最良（V4.1 Flash の 39、V4 Pro の 36）を上回るが、出力は 46 tok/s・TTFT 3.5 秒で DeepSeek Flash 系（225〜237 tok/s）の約 1/5、V4 Pro（91〜99）の約半分。価格は Pro が入力 $0.435 / 出力 $0.87 で v4-pro（$0.66 / $1.98）より安く、Flash は $0.14 / $0.28。ただし推論が既定で有効で、ツールを使う複数ターンでは前の reasoning_content を送り返さないと API が拒否する（LiteLLM 公式、実践者も 400 を再現）。独立したツール呼び出しの測定は両社ともゼロ、SWE-bench 系の自己申告には汚染の疑義（Epoch AI、二次情報）、推論が無限に回る実地報告（MiMo-Code #2527）。main は速さが要るので deepseek-flash を崩す根拠はない。complex は試す価値があるが切り替えの根拠にはまだならない。deterministic 向けの 9B 蒸留版は llama.cpp でツール呼び出しが終わらない不具合（#29319、open）で使えない。"
unverified:
  - MiMo と DeepSeek の独立したツール呼び出しの測定（BFCL・tau-bench）— 両社とも見つからない
  - Epoch AI の汚染の指摘の原文（eesel AI の二次記事のみ）
  - 両社のプライバシーポリシーの原文（どちらも本文を取得できず、要約経由）
  - 日本から使えるか（ブロックの記載が見当たらないだけ）
  - MiMo-V2.6-Flash の独立した速度と知能指数
  - DSH・omp で MiMo を使った実践者の報告（pi と OpenCode のみ）
---

# MiMo と DeepSeek の比較

前提: main / complex の文脈の予算は 200K（`rules/decisions/2026-09-24-context-window-budget-200k-extended-1m.md`）。`gh` は TLS 検証に失敗したため、GitHub は認証なしの REST API で取得した（code search は認証が要り未到達）。

## ベンダー

MiMo の系譜（https://mimo.mi.com/docs/en-US/updates/model 、https://en.wikipedia.org/wiki/Xiaomi_MiMo 、https://huggingface.co/XiaomiMiMo ）:

| モデル | 発表 | 総 / 活性 | 文脈 |
|---|---|---|---|
| MiMo-7B | 2025-04-30 | 7B（旧世代） | — |
| MiMo-V2-Flash | 2025-12-16 | 309B / 15B | 256K |
| MiMo-V2-Pro | 2026-03-18 | 1T 超 / 42B | 1M |
| MiMo-V2.5 / V2.5-Pro | 2026-04-22/23 | Pro 1T / 42B | 1M |
| MiMo-V2.6-Pro | 2026-09-21/22 | 1.02T / 42B（MoE） | 1M、出力 128K |
| MiMo-V2.6-Flash | 同 | 309B / 15B | 1M |
| MiMo-V2.6-Distill-Qwen-9B | 同 | 9B（Qwen3.5-9B に SFT） | — |

ライセンスは V2.5 以降 MIT、V2-Flash は Apache-2.0（https://github.com/xiaomimimo/MiMo-V2-Flash 、https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B ）。

API: `https://api.xiaomimimo.com/v1`（OpenAI 互換）と `/anthropic`（https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call ）。

価格（1M トークンあたり）:
- MiMo（https://docs.litellm.ai/blog/mimo_v2_6 ）: "pro model costs $0.435 input and $0.87 output"、"flash variant is $0.14 and $0.28"、"Cached input reads on the pro model are $0.0036"。
- DeepSeek（https://api-docs.deepseek.com/quick_start/pricing ）: deepseek-flash はキャッシュヒット $0.003 / $0.006、ミス $0.15 / $0.3、出力 $0.6 / $1.2（オフピーク / ピーク）。deepseek-v4-pro はヒット $0.022 / $0.044、ミス $0.66 / $1.32、出力 $1.98 / $3.96。どちらも 1M 文脈・出力上限 384K。"Off-peak rates are half of the peak rates. Peak hours are 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday, excluding Chinese public holidays."

LiteLLM（https://docs.litellm.ai/docs/providers/xiaomi_mimo 、https://docs.litellm.ai/blog/mimo_v2_6 ）: `xiaomi_mimo/` で対応。"Reasoning activates by default on both versions."、"developers must explicitly pass the thinking parameter through `allowed_openai_params=["thinking"]`"、"For multi-turn conversations using tools, the system requires including `reasoning_content` from prior assistant responses or the API will reject the request."、"Xiaomi deprecates `mimo-v2.5-pro` and `mimo-v2.5` at 10:00 Beijing time on October 21, 2026."

## 実践者

- Curtis Pyke（Kingy AI、https://kingy.ai/blog/mimo-v2-6-pro-free-access-pricing-setup/ ）: OpenCode で 3 課題。"Pro and Opus 5 passed 23 of 23"、"Pro completed tasks for approximately $0.03 versus Opus 5's $1.03"。Flash は "21 of 23" で、自分で書いたテストが欠けた機能に気づかなかった。"using OpenCode with Xiaomi's Anthropic-compatible endpoint can return a 400 error in multi-turn tool calls, because the reasoning content is not passed back"。
- pi は MiMo を組み込みのプロバイダとして持つ（earendil-works/pi #3912、PR #4005 でマージ）。
- DogukanUrker（https://x.com/DogukanUrker/status/2102326190757323185 、要約経由）: 9B 蒸留版を RTX 3060 12GB の Q5_K_M、262K 文脈で約 47 tok/s。
- MiMo-Code #2527（open、2026-09-24）: OpenCode 経由の V2.6 で、推論の中で「わからない → 確かめると宣言 → 何もしない → 最初に戻る」を 3 周以上、人が止めるまで繰り返す。
- MiMo-Code #2538（open）: 技術レポートのエージェント系の数値をどのハーネスで測ったか公開してほしいという質問に、回答なし。

## 測定

ベンダーの自己申告（VentureBeat、https://venturebeat.com/technology/xiaomis-new-open-source-agentic-ai-coding-harness-mimo-code-beats-claude-code-at-ultra-long-200-step-tasks ）: MiMo-V2.5-Pro を MiMo Code と Claude Code で比べ、SWE-bench Verified 82% / 79%、Pro 62% / 55%、Terminal-Bench 2 73% / 69%。記事自身が "these are vendor self-reported numbers that haven't been independently verified" と書く。

独立（Artificial Analysis、https://artificialanalysis.ai/models/mimo-v2-6-pro 、https://artificialanalysis.ai/providers/deepseek ）:

| モデル | Intelligence Index | 出力速度 | TTFT | 価格 |
|---|---|---|---|---|
| MiMo-V2.6-Pro | 46 | 46.1 tok/s | 3.53s | $0.43 / $0.87 |
| DeepSeek V4 Pro 0813 (max) | 36 | 91〜99 tok/s | — | 混合 $0.67 |
| DeepSeek V4.1 Flash (max) | 39 | 236〜237 tok/s | — | 混合 $0.18 |
| DeepSeek V4 Flash 0731 (max) | 34 | 225 tok/s | — | 混合 $0.22 |

- 9B 蒸留版のモデルカード: SWE-bench Verified 61.1%、Pro 44.6%（元の Qwen3.5-9B は 60.0 / 32.0）。
- 汚染の疑義（eesel AI、https://www.eesel.ai/blog/xiaomi-mimo-v2-6-review 、二次情報）: "Epoch AI classifies some of MiMo-V2.6's headline coding benchmarks—SWE-bench Verified and DeepSWE v1.1—as flawed because of scoring, contamination, or task-quality problems"。

## 実地

- XiaomiMiMo/MiMo-Code: ★13,495、MIT、2026-09-26 push、open issue 1,083（#2518 クラッシュハンドラが 13 日以上 CPU を食う、#2549 許可なく透かしを書き込む など）。
- opencode.ai の利用データ（https://opencode.ai/data/compare/deepseek/deepseek-v4-1-flash/xiaomi/mimo-v2-6-flash ）: DeepSeek V4.1 Flash は 909K ユーザー・トークンシェア 13.5%、MiMo-V2.6-Flash は 154K・0.66%。MiMo は公開 4 日目なので、少ないのは新しいため。
- llama.cpp #29319（open）: "MiMo-V2.6-Distill-Qwen-9B chat template misdetected as Qwen3-Coder (tool calls never complete)"。ツール呼び出しが毎回トークン上限まで走り `finish_reason: "length"` で終わる。GGUF は bartowski などが公開（https://huggingface.co/bartowski/MiMo-V2.6-Distill-Qwen-9B-GGUF ）。

## データの扱い（要約経由、原文未取得）

- Xiaomi: API の内容は学習に使わないとされるが、デスクトップアプリは別の規約。データセンターは北京・米国・ロシア・シンガポール・ドイツ。
- DeepSeek: 中国のサーバーに保存し、既定で会話を学習に使う。
- 日本から使えないという記載はどちらにも見当たらない。

## この記録で言えること

| tier | 今 | MiMo の候補 | 判断 |
|---|---|---|---|
| main | deepseek-flash | V2.6-Flash（$0.14 / $0.28） | 速さが要る tier。V2.6-Flash の独立した速度がなく、reasoning_content の送り返しが要る。切り替える根拠なし |
| complex | deepseek-v4-pro | V2.6-Pro（$0.435 / $0.87） | 知能指数 46 対 36 で上、価格も安い。遅さ（46 tok/s）は complex では許せる。ただしツール呼び出しの独立測定なし、無限ループの報告、reasoning_content の送り返しが要る。試す価値はあるが、まだ切り替える根拠にはならない |
| deterministic | Qwen3.8-27B（3090 Ti） | V2.6-Distill-Qwen-9B | llama.cpp でツール呼び出しが終わらない（#29319）。直るまで使わない |

副次的な発見: DeepSeek には V4.1 Flash（知能指数 39、236 tok/s）がある。main の `deepseek-flash` が今どの版を指しているかは確かめていない。

## 追補: X の一次情報（2026-09-27、fxtwitter で原文を確認）

投稿は Web 検索で見つけ、本文は `https://api.fxtwitter.com/<user>/status/<id>` の `tweet.text` から取った。Artificial Analysis の MiMo-V2.6-Flash 単独のページは 404 で、独立機関はまだ Flash を測っていない。

| 投稿 | 投稿者 | 日付 | 内容 | 測り方の記載 |
|---|---|---|---|---|
| https://x.com/Tech2Wild/status/2102215150203719903 | 個人のホームラボ（4,258） | 2026-09-22 | Flash を 2x DGX Spark・vLLM + DFlash（投機的デコード）で "88 tok/s single-stream on counting"、"206 on code"、"0.37s TTFT" | あり（ただし特殊な構成で、クラウドの数字とは比べられない） |
| https://x.com/Tech2Wild/status/2102263581060309172 | 同 | 2026-09-22 | "this model can lock into repeating the same tool call inside one response until max_tokens. We saw single turns with 148 and 446 identical grep calls, and 44-minute turns of repeated bash checks"。OMP・DeepSeek Harness でも起きた。回避は `--generation-config auto` と `repetition_penalty 1.05` | あり |
| https://x.com/CommandCodeAI/status/2102590815541600656 | Command Code（コーディングエージェント製品、24,594） | 2026-09-23 | 同じ課題で "DSV4.1-Flash: 9/10 · $0.024 · one-shot"、"Mimo-V2.6-Flash: 8/10 · $0.018 · playable 2D result in ~4 iterations" | あり（自社の課題、機械の記載なし） |
| https://x.com/DogukanUrker/status/2102326190757323185 | 個人のホームラボ（1,457） | 2026-09-22 | 9B 蒸留版（Flash 本体ではない）を RTX 3060 12GB・Q5_K_M で "~47 tok/s decode, ~1600 tok/s prefill" | あり |
| https://x.com/opencode/status/2102145730999730611 | OpenCode 公式 | 2026-09-21 | "MiMo V2.6 Flash is free for the next week" | なし |
| https://x.com/XiaomiMiMo/status/2102138585491361942 | Xiaomi MiMo 公式 | 2026-09-21 | Pro-UltraSpeed が "up to 20× faster generation"（基準の記載なし） | なし |

- Xiaomi・OpenRouter・OpenCode の公式の投稿は告知だけで、独自の測定はない。
- ツール呼び出しを延々と繰り返す報告は、X の Tech2Wild のほか、MiMo-Code の issue に少なくとも 7 件（#914・#1181・#2436・#2496・#2497・#2509・#2527、要約経由）。経路（vLLM・OpenCode・MiMo Code Desktop）の違う場所で同時期に出ている。
- 中国語のコミュニティ（知乎・Linux.do）に「Flash は名前ほど速くない」という趣旨の投稿があるが、原文に届かなかった（[unverified]）。
- この追補で main / complex の判断は変わらない。むしろ切り替えを支持しない材料（ツール呼び出しの繰り返し）が増えた。

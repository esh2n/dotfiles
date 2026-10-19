---
id: "11"
category: ja-chat
reader: 前の会話を読んでいない利用者
task: 「executor のモデルが落ちたらクラウドのモデルに切り替えればいいのでは？」という質問への返答を書く。
traps: [腕, 窓, 家の LLM]
must_keep: [executor, LiteLLM, llama-server]
---

## 事実

1. executor は同じモデル Qwen3.8-27B の置き場所を 2 つ持ち、LiteLLM の同じ名前の下に並べている。
2. 1 つ目は Linux の GPU 機（VRAM 24GB）の llama-server で、LiteLLM が 60 秒ごとに死活を確かめる。
3. 2 つ目は Mac の LM Studio で、必要になったときに読み込み、600 秒使われなければ外す。1 つ目が使えないあいだだけ使う。
4. 別のモデルへは切り替えない。
5. executor を使う理由は、会話と手元のコードを外に出さないことなので、クラウドに切り替えるとその理由が崩れる。
6. どの置き場所が答えたかは x-litellm-model-api-base ヘッダーで分かる。

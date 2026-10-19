---
id: "07"
category: ja-chat
reader: 前の会話を読んでいない利用者
task: 「DeepSeek に effort を high 以外で送っても挙動が変わらない気がする。なぜ？」という質問への返答を書く。
traps: [窓, 強い格]
must_keep: [LiteLLM, effort, reasoning_effort]
---

## 事実

1. LiteLLM は DeepSeek への reasoning_effort の段階を送らずに捨てていた。
2. その結果、main と complex の tier は常に DeepSeek の既定の high で動いていた。
3. この結論は LiteLLM の deepseek/chat/transformation.py を読んで出したもので、実際に送って確かめてはいない。
4. 決定では、この件を直し、段階が届くことを実際に送って確かめる。
5. DeepSeek に xhigh の段階は無く、xhigh を指定したときは high に下げて記録する。

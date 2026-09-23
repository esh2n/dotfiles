# 自宅 LLM は LM Studio だけを Tailscale に出し、LiteLLM は各機械の loopback に置き、スマホは Open WebUI で使う

Status: accepted — 実地で別マシン到達をやっている全員が「推論サーバーは loopback、境界は Tailscale の身元だけ」で、受付層を外に向ける前例はゼロ。サーバーは LM Studio を維持する証拠が揃い（headless・tool calling・structured output が公式、実測 parallel 4）、スマホは Open WebUI 以外の実務解が見つからない（2026-09-23）

rule: Expose only LM Studio over the tailnet (`tailscale serve --bg --tcp 1234 127.0.0.1:1234`); keep LiteLLM loopback-only on every machine, one instance per machine, pointing at the local LM Studio when it answers and at the Mac's tailnet name otherwise; keep jig's tiers at `localhost:4000` unchanged; serve the phone through Open WebUI on the Mac over Tailscale. Never expose LiteLLM or LM Studio to the LAN or the internet.

## Problem

自宅の Mac（64GB）にある LM Studio のモデルを、三つのユースケースで使いたい。U1: その Mac 上（今）。U2: ローカル LLM を持たない別 PC で jig ハーネス（判断サービス・tier 振り分け・LiteLLM 計測）を使い、モデルだけ Mac のものを使う。U3: スマホから、自宅外含む。サーバー（LM Studio か別か）、受付層（LiteLLM を置くか、外に出すか）、到達経路をどう組むか。同じ dotfiles を複数機で使うとき、機械ごとの差分をどう持つか。

## Decision

- **サーバーは LM Studio を維持する。** headless daemon（`lms daemon up`）、tool calling、structured output（jig の判断問いに要る）が公式 docs で裏付けられ、実測の同時処理数は 4（Ollama は既定 1）。モデルは既にある。
- **外に出すのは LM Studio だけ、経路は Tailscale の身元。** Mac で一度 `tailscale serve --bg --tcp 1234 127.0.0.1:1234`。LM Studio 自体は `127.0.0.1` のまま。LAN 直 bind もインターネット公開もしない。
- **LiteLLM は各機械に一つ、loopback のまま。** 外に向けない。バックエンドの LM Studio の場所は起動スクリプトが自動判定する — `127.0.0.1:1234` が応えれば local、応えなければ Mac の Tailscale 名。機械ごとの設定ファイルや hostname 分岐は持たない。jig の tiers は `localhost:4000` のまま一切変えず、計測もその機械で取れる。
- **スマホは Open WebUI（PWA）** を Mac に常駐させ Tailscale 越しに開く。バックエンドは loopback の LM Studio（または local の LiteLLM）。
- 前回記録が推した「LiteLLM を tailnet に出して二重認証」は取り下げる。前例ゼロの物を外に向ける理由が無く、LiteLLM を外に出さなければ二重認証の論点自体が消える。

## Alternatives considered

- **(c) LiteLLM :4000 を tailnet に出す（前回の推し）**: 設計の一貫性（境界 = LiteLLM、鍵 = op）が根拠だったが、実地の別マシン到達例（ncaq、kuznero、norllama）は全員 Tailscale の身元だけを境界にしアプリ層の鍵を重ねない。LiteLLM 自体に Security Advisory 14 件（critical 4、うち無認証 SQLi CVSS 9.3）。現行 pin 1.103.0 は全て修正後で実害は無いが、「外に向ける面」に置く物ではない。却下。
- **(a) LM Studio を LAN に bind**: 0.4.24 でも headless では認証を CLI から有効化できず（lms#489）、macOS の Application Firewall は LAN/WAN を区別しない。却下（前回記録どおり）。
- **Ollama / llama-server / mlx-lm に乗り換える**: llama-server は `--api-key` と並行スロットを素で持つが、既存の MLX 資産と非互換で GGUF の調達が要り、外に向けるのは Tailscale が担うので認証の差は効かない。Ollama は既定並行 1、mlx-lm は "not recommended for production"。却下。
- **受付層を Olla や自作ミニゲートウェイに替える**: 軽い（<50MB）が、jig の生成器（`write-litellm.ts`）と計測（Prometheus）が LiteLLM を前提に既にある。「軽い代替がある」は「乗り換えるべき」の証拠ではない。却下。
- **Ollama Cloud のようなホスト型に逃がす**: 自宅露出は避けられるが、ローカルで動かす動機（私的・無料）と矛盾。却下。
- **機械ごとの差分を hostname 分岐や git 外の env ファイルで持つ**: 差分は LM Studio の場所一つだけなので、自動判定のほうが設定漏れが起きない。却下。

## Consequences

- `domains/dev/config/litellm/litellm-up.sh` が LM Studio の場所を自動判定する（`LM_STUDIO_REMOTE_HOST` に Mac の Tailscale 名を一度書く）。
- Tailscale の導入（各機械、ユーザーのログイン）、Mac での `tailscale serve` 一回、Open WebUI の常駐は未実施。
- 起動スクリプトと plist は macOS 前提（launchd、Docker Desktop/OrbStack）。Linux 機では systemd unit と `host.docker.internal` の代替が要る — flake の per-system 化の一部として扱う。
- Mac のスリープ対策（`pmset` の disablesleep か `caffeinate` の常駐か）は別途決める。どの形でも共通の課題。
- 前例なし: Open WebUI を LiteLLM の bearer key 構成に繋いだ公開例、LiteLLM 単体（1 コンテナ・Mac 常駐）のレイテンシ実測。

## Sources

- `rules/research/2026-09-23-home-llm-server-gateway-by-use-case.md`
- `rules/research/2026-09-23-local-llm-across-home-machines.md`
- LM Studio: https://lmstudio.ai/docs/app/api/headless 、https://lmstudio.ai/docs/developer/openai-compat/structured-output 、https://lmstudio.ai/docs/developer/openai-compat/tools
- Ollama 並行数: https://docs.ollama.com/faq 、llama-server: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- LiteLLM advisories: https://api.github.com/repos/BerriAI/litellm/security-advisories
- 実践者: https://github.com/ncaq/dotfiles 、https://github.com/kuznero/dotfiles 、https://github.com/KristopherKubicki/norman 、Willison: https://til.simonwillison.net/llms/codex-spark-gpt-oss

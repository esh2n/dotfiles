# 自宅LLMはLM StudioだけをTailscaleに出し、LiteLLMは各機械のloopbackに置き、スマホはOpen WebUIで使う

Status: accepted — 実地で別マシン到達をやっている全員が「推論サーバーはloopback、境界はTailscaleの身元だけ」で、受付層を外に向ける前例はゼロ。サーバーはLM Studioを維持する証拠が揃い（headless・tool calling・structured outputが公式、実測parallel 4）、スマホはOpen WebUI以外の実務解が見つからない（2026-09-23）

rule: Expose only LM Studio over the tailnet (`tailscale serve --bg --tcp 1234 127.0.0.1:1234`); keep LiteLLM loopback-only on every machine, one instance per machine, pointing at the local LM Studio when it answers and at the Mac's tailnet name otherwise; keep jig's tiers at `localhost:4000` unchanged; serve the phone through Open WebUI on the Mac over Tailscale; aggregate metrics by the Mac's Prometheus scraping each machine's LiteLLM /metrics over the tailnet (LiteLLM's dedicated metrics listener `--prometheus_metrics_port 4001`, served with `tailscale serve --tcp 4001`; the chat port 4000 stays loopback); separation of other users = op key references + tailnet membership. Never expose LiteLLM or LM Studio to the LAN or the internet.
scope: repo

## Problem

Mac（メモリ64GB）のLM Studioのモデルを、三つのユースケースで使いたい。U1: そのMac上（今）。U2: ローカルLLMを持たない別PCでjigハーネス（判断サービス・tier振り分け・LiteLLM計測）を使い、モデルだけMacのものを使う。U3: スマホから（家の外を含む）。サーバー（LM Studioか別か）、受付層（LiteLLMを置くか、外に出すか）、到達経路をどう組むか。同じdotfilesを複数機で使うとき、機械ごとの差分をどう持つか。

## Decision

- **サーバーはLM Studioを維持する。** headless daemon（`lms daemon up`）、tool calling、structured output（jigの判断問いに要る）が公式docsで裏付けられ、実測の同時処理数は4（Ollamaは既定1）。モデルは既にある。
- **外に出すのはLM Studioだけ、経路はTailscaleの身元。** Macで一度`tailscale serve --bg --tcp 1234 127.0.0.1:1234`。LM Studio自体は`127.0.0.1`のまま。LAN直bindもインターネット公開もしない。
- **LiteLLMは各機械に一つ、loopbackのまま。** 外に向けない。バックエンドのLM Studioの場所は起動スクリプトが自動判定する — `127.0.0.1:1234`が応えればlocal、応えなければMacのTailscale名。機械ごとの設定ファイルやhostname分岐は持たない。jigのtiersは`localhost:4000`のまま一切変えず、計測もその機械で取れる。
- **スマホはOpen WebUI（PWA）** をMacに常駐させTailscale越しに開く。バックエンドはloopbackのLM Studio（またはlocalのLiteLLM）。
- 前回記録が推した「LiteLLMをtailnetに出して二重認証」は取り下げる。前例ゼロの物を外に向ける理由が無く、LiteLLMを外に出さなければ二重認証の論点自体が消える。
- **計測の集約はMacのPrometheusが各機械のLiteLLM `/metrics`をtailnet越しにpullする。他人との分離はopの鍵参照とtailnetの所属で足りる**（同日の裁定）。押す側（pusher）もアプリ層の認証も置かない — 身元はtailnetが持つ。同じdotfilesを他人が使っても、リポジトリに秘密は無く`op://`参照はその人の1Passwordで解決され（自分の鍵か、何も無いか）、tailnetが違えば機械同士は到達できない。出し方は「chat APIはloopbackのまま、metricsだけ出す」: LiteLLM v1.101.0以降の専用metrics listener（`--prometheus_metrics_port 4001`、pin中のイメージは1.103.0）を`127.0.0.1:4001`にpublishし、Mac以外の機械で`tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001`を一度。`:4000`を`tailscale serve`に載せる案はchat APIごとtailnetに出るので却下。専用listenerはLiteLLMの鍵認証を持たない（vendor: "The dedicated listener does not use LiteLLM virtual-key authentication ... Permit access only from trusted Prometheus or collector networks"）ので、到達範囲はtailnet ACL（`home/shared/tailscale/config/acl.hujson`、自分の機器同士の`tcp:4001`と`tcp:1234`だけ）で絞る。

## Alternatives considered

- **(c) LiteLLM :4000をtailnetに出す（前回の推し）**: 設計の一貫性（境界 = LiteLLM、鍵 = op）が根拠だったが、実地の別マシン到達例（ncaq、kuznero、norllama）は全員Tailscaleの身元だけを境界にしアプリ層の鍵を重ねない。LiteLLM自体にSecurity Advisory 14件（critical 4、うち無認証SQLi CVSS 9.3）。現行pin 1.103.0は全て修正後で実害は無いが、「外に向ける面」に置く物ではない。却下。
- **(a) LM StudioをLANにbind**: 0.4.24でもheadlessでは認証をCLIから有効化できず（lms#489）、macOSのApplication FirewallはLAN/WANを区別しない。却下（前回記録どおり）。
- **Ollama / llama-server / mlx-lmに乗り換える**: llama-serverは`--api-key`と並行スロットを素で持つが、既存のMLX資産と非互換でGGUFの調達が要り、外に向けるのはTailscaleが担うので認証の差は効かない。Ollamaは既定並行1、mlx-lmは "not recommended for production"。却下。
- **受付層をOllaや自作ミニゲートウェイに替える**: 軽い（<50MB）が、jigの生成器（`write-litellm.ts`）と計測（Prometheus）がLiteLLMを前提に既にある。「軽い代替がある」は「乗り換えるべき」の証拠ではない。却下。
- **Ollama Cloudのようなホスト型に逃がす**: 自宅露出は避けられるが、ローカルで動かす動機（私的・無料）と矛盾。却下。
- **機械ごとの差分をhostname分岐やgit外のenvファイルで持つ**: 差分はLM Studioの場所一つだけなので、自動判定のほうが設定漏れが起きない。却下。

## Consequences

- `home/shared/litellm/config/litellm-up.sh`がLM Studioの場所を自動判定する（`LM_STUDIO_REMOTE_HOST`にMacのTailscale名を一度書く）。
- Tailscaleの導入（各機械、ユーザーのログイン）、Macでの`tailscale serve`一回、Open WebUIの常駐は未実施。
- 起動スクリプトとplistはmacOS前提（launchd、Docker Desktop/OrbStack）。Linux機ではsystemd unitと`host.docker.internal`の代替が要る — flakeのper-system化の一部として扱う。
- Macのスリープ対策は`caffeinate -s -w <LM Studio の daemon の pid>`をlaunchdでdaemonに紐づける（同日の裁定）。`pmset -a disablesleep 1`は機械全体を恒久に起こすので採らない — サーバーが動いている間だけ起きている、が正しい範囲。
- Tailscale・LM Studio・LiteLLM・Open WebUIは手で入れずdotfilesが入れる（同日の指示）: GUIアプリは`system/darwin/homebrew.nix`のcask、常駐はlaunchdのplist、Open WebUIはobservabilityのdocker-compose。
- 前例なし: Open WebUIをLiteLLMのbearer key構成に繋いだ公開例、LiteLLM単体（1コンテナ・Mac常駐）のレイテンシ実測。
- `litellm-up.sh`は全機械で`--prometheus_metrics_port 4001`を付け`127.0.0.1:4001`にpublishする（loopbackなのでMacでも無害）。tailnetに載せるのはMac以外の機械だけ、`tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001`を一度（LM Studioの1234と同じ手順、未実施）。
- `home/shared/litellm/config/observability/prometheus/prometheus.yml`のlocal targetはそのまま。他機械のtargetはMagicDNS名`<machine>.<tailnet>.ts.net:4001`に`machine`ラベルを付けたコメントアウト済みブロックで持ち、機械が増えたときに外す。コンテナからMagicDNS名が引けなければTailscale IP（100.x）に置き換える（未実測）。
- `require_auth_for_metrics_endpoint: false`は据え置き。これはproxy port（4000）の`/metrics`にしか効かず、4000はloopbackから出ないため。専用listener側は設定に関係なく無認証で、境界はtailnet ACLのみ — tailnetの外に出す日が来たら、その時は専用listenerを止めて4000側を`true`にしBearerでscrapeする。
- Tailscaleのpolicy fileはadmin consoleに住む。`home/shared/tailscale/config/acl.hujson`はそこへ貼る原本（またはGitOps: `tailscale/gitops-acl-action`が`policy.hujson`をPRでtest、mainへのpushでapply）。貼ると既定のallow-allが消えるので、SSH等ほかに要る許可は同じファイルに足す。
- 持ち主の裁定（2026-09-23）: Tailscale越しにSSH・画面共有等も通すので、ACLは「自分の機械同士は全ポート、他人・タグ付き・共有ノードは無し」とする（ポート列挙の3本版はファイル内にコメントで保持）。4000の「出さない」保証はACLではなく`tailscale serve`に載せないことで持つ。貼る操作は`make tailscale-acl`（実値を埋めてクリップボードへ）。
- 持ち主の裁定（同夜）: 機械側の手順（launchdのbootstrap、`tailscale serve`、docker compose、`pi install`、`claude mcp add`）は独立スクリプトにせず一つの入口に畳む — 当時は`domains/dev/install.sh`と`make install` / `make update`だったが、`domains/`は52411843で消え、今は新しい機械も既存の機械も`make up`の一発で揃える。人手の残作業は末尾に一覧で出す。
- 持ち主の裁定（2026-09-23）: 手で入れてあったLM Studioはcaskに置き換える（アプリをTrash → `make up`）。`brew --adopt`は版が一致しても通らなかった（アプリ内更新のbundleはDMGと同一でない）。

## Sources

- LM Studioヘッドレスの認証トグルがCLIから有効化できない未解決バグ（LAN直bindを却下する根拠）: https://github.com/lmstudio-ai/lms/issues/489
- LM Studio: https://lmstudio.ai/docs/app/api/headless 、https://lmstudio.ai/docs/developer/openai-compat/structured-output 、https://lmstudio.ai/docs/developer/openai-compat/tools
- Ollama並行数: https://docs.ollama.com/faq 、llama-server: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- LiteLLM advisories: https://api.github.com/repos/BerriAI/litellm/security-advisories
- LiteLLM専用metrics listener: https://docs.litellm.ai/docs/proxy/prometheus （"LiteLLM v1.101.0 and later can serve the same metric set from a dedicated process. Configure --prometheus_metrics_port or PROMETHEUS_METRICS_PORT"）
- Prometheus static_configs/labels: https://prometheus.io/docs/prometheus/latest/configuration/configuration/ 、Tailscale ACL/grants: https://tailscale.com/kb/1018/acls 、https://tailscale.com/kb/1324/grants 、https://tailscale.com/kb/1337/acl-syntax 、ServeはACLに従う: https://tailscale.com/kb/1312/serve 、GitOps: https://tailscale.com/kb/1204/gitops-acls
- 実践者: https://github.com/ncaq/dotfiles 、https://github.com/kuznero/dotfiles 、https://github.com/KristopherKubicki/norman 、Willison: https://til.simonwillison.net/llms/codex-spark-gpt-oss

# モデルの経路: ベンダー製ハーネスは自社モデル、それ以外はLiteLLMのtier

Status: superseded by 2026-09-27-model-catalog-and-tier-assignment.md（tier → モデルは候補の一覧と割り当てから生成するようにした。ベンダー製ハーネスは自社モデル、それ以外はtierだけ、はそちらが引き継ぐ） — accepted — 持ち主の裁定（2026-09-23）。ompがAnthropic OAuthの失効で無言でopenai-codex / gpt-5.5に落ちていたのを見つけた場で出た

rule: Claude Code runs Claude models and Codex runs OpenAI's; every other harness (pi, DSH, omp) sends all model calls through the local LiteLLM proxy at `localhost:4000` using only the tier aliases `main` (everyday), `complex` (escalation) and `deterministic` (local LM Studio, reproducible/offline), never a provider directly. Tier → model is decided once in `litellm/config.yaml`; a harness config names tiers, not models. A harness that silently falls back to another provider when its default's auth fails is a defect to fix, not a state to leave.

## Problem

五ハーネスで「どのモデルで動くか」を一つの表として追跡していなかった。実測（2026-09-23）: Claude Code = Claude（OAuth直）、Codex = `gpt-5-codex`（`config.toml`、古いID）、pi = `proxy/main`、DSH = `localhost:4000`、omp = 設定は`anthropic/claude-fable-5`だがAnthropic OAuthのrefresh tokenが失効（`invalid_grant`）し、ompは認証の通る唯一のプロバイダopenai-codexに落ちてgpt-5.5を使っていた。測定（LiteLLMのPrometheus）にも載らない。

## Decision

- Claude Code → Claude、Codex → OpenAI。ベンダー製ハーネスはベンダーのモデル。
- pi・DSH・omp → LiteLLMのtierだけ（`main` / `complex` / `deterministic`）。プロバイダ直結の設定は置かない。
- omp: `home/shared/harness/omp/models.yml`にプロバイダ`proxy`（`http://localhost:4000/v1`、`apiKey: LITELLM_API_KEY`）、`config.yml.template`の`modelRoles`は全部`proxy/*`（default / smol / tiny / commit / task → `main`、slow / plan / advisor → `complex`）。鍵はpiと同じくzshの`omp()`ラッパーが`proxy-key.sh`で一度解決して渡す。
- ompのsubagent表（`agents/models.json`の`omp`）: sonnet・haiku → `proxy/main`、opus → `proxy/complex`（codex表と同じ考え方）。
- 未裁定: Codexも他社のモデルを使えるはずで、Codexの一部をLiteLLM経由にするかは別件でgrill。

## Alternatives considered

- **ompをAnthropic OAuthに再ログインさせて据え置く**: 第三者ハーネスがサブスクのOAuthを使う可否がベンダー方針に依存し、失効が再発する。調査記録: Anthropicは2026-01にopencodeでClaude MaxのOAuthを使った利用者をBANし、opencode側は「anthropic legal demanded we respond … their ToS prohibits using your claude max subscription outside of claude code」とクローズしている（https://github.com/anomalyco/opencode/issues/6930 ）。公式に認めるのはAgent SDK経由だけで、それも6/15にpause（https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan ）。今回の`invalid_grant`はomp自身の並行refresh競合（https://github.com/can1357/oh-my-pi/issues/5396 ）でもBANでも同じ文字列になり判別できない。持ち主の方針（ベンダー製以外はLiteLLM）にも反する。却下。
- **五ハーネス全部をLiteLLM経由**: Claude CodeとCodexはサブスク（OAuth）で動き、API課金に変わる。ベンダー製ハーネスが自社モデルを使う現状を変える理由が無い。却下。

## Consequences

- ompの主モデルがDeepSeek（`main`）になり、Claudeではなくなる。ompでClaudeを使いたい場面は`complex`の中身（`litellm/config.yaml`）で決める。
- ompの`review` / `scout`（ompの文書に無いrole名）は消え、文書にあるrole（default / smol / tiny / commit / task / slow / plan / advisor）だけを使う。
- `~/.omp/agent/config.yml`はテンプレートの複製なので、次の`make update`（template pass）で置き換わる。
- Codexの`config.toml`の`model = "gpt-5-codex"`は古いIDのまま。Codexのモデルと「Codexで他モデル」は別件のgrill。
- ompの無言フォールバックは仕様: `findInitialModel`は「5. first available model」まで落ちる（https://github.com/can1357/oh-my-pi/blob/main/docs/models.md ）。`proxy`を足してもopenai-codexのOAuthがompに残っていれば、proxyが落ちた日はまた黙ってgpt-5.5に行く。**持ち主の手: ompの中でanthropicとopenai-codexの認証を消す**（`/logout`相当）。プロバイダが`proxy`だけなら、落ちたときは「no auth」で止まり、それが正しい失敗の見え方。
- piは「No auto-fallback to another provider」が設計方針（https://github.com/earendil-works/pi/pull/8966 ）だが起動レースで10回中4回別モデルで起動する報告あり（https://github.com/earendil-works/pi/issues/8810 ）。piの設定は`proxy`一本なので今の構成では落ち先が無い。
- 記録: `rules/knowledge/vendor-subscription-oauth-tos-risk.md`。
- 振り分け: 同日夜の裁定`2026-09-23-tier-fixed-main-subagent-escalation.md`で上書き — セッションは一つのtierに固定（`main`）、`complex`はsubagent、`/tier`は人の選択。pi / ompの拡張は保持だけを行い、プロンプトごとの判定は削除。
- 2026-09-24: ompの`proxy`ブロックは手書きをやめ`policy/tiers.json`から生成（`jig apply --target omp`のtiers半分、`models.yml`の`# BEGIN jig:tiers`区間）。手書き版は`contextWindow` / `maxTokens`を持たずompの既定128,000 / 16,384が効いていた（omp docs/models.mdの既定値）。正しくはmain / complex = 1,000,000（DeepSeekの価格表でdeepseek-flash・deepseek-v4-proともCONTEXT LENGTH「1M」、MAX OUTPUT「MAXIMUM: 384K」、https://api-docs.deepseek.com/quick_start/pricing 、2026-09-24読了）、deterministic = 131,072（LM Studioでロードしたqwen3.8-27bの窓。モデル定数ではなくロード設定なので、`check.sh`が出す`loaded_context_length`に合わせる。[unverified: 実機の値は次のcheckで確定]）。出典は`policy/tiers.json`の各tierの`_context_source`にも記載。pi / DSHは以前から同じ源。Claude Code / Codexはベンダーのモデルで各自の窓。
- 未実測: ompから`proxy/*`を実際に叩いた結果（compat設定が要るか — piは`supportsDeveloperRole: false` / `maxTokensField: max_tokens`を指定している）。

## Sources

- ompのprovider設定: https://github.com/can1357/oh-my-pi/blob/main/docs/models.md（`apiKey` は「Value is first treated as an environment variable name」、roleはdefault / smol / slow / vision / plan / commit / tiny / task / advisor）
- LiteLLMのtier定義: `home/shared/litellm/config/config.yaml`、`home/shared/litellm/config/README.md`「Point a harness at it」
- 先行の裁定: `2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`（jigのtierは`localhost:4000`のまま）

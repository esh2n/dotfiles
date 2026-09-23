# モデルの経路: ベンダー製ハーネスは自社モデル、それ以外は LiteLLM の tier

Status: accepted — 持ち主の裁定（2026-09-23 夜）。「ClaudeCode と Codex はモデルを作っているベンダーのハーネスなので自社モデルで違和感がない。pi・DSH・omp はどのモデルも使えるので LiteLLM の 2 段（main / complex）と、決定的なタスクはローカル LLM」。omp が Anthropic OAuth の失効で無言で openai-codex / gpt-5.5 に落ちていたのを見つけた場で出た

rule: Claude Code runs Claude models and Codex runs OpenAI's; every other harness (pi, DSH, omp) sends all model calls through the local LiteLLM proxy at `localhost:4000` using only the tier aliases `main` (everyday), `complex` (escalation) and `deterministic` (local LM Studio, reproducible/offline), never a provider directly. Tier → model is decided once in `litellm/config.yaml`; a harness config names tiers, not models. A harness that silently falls back to another provider when its default's auth fails is a defect to fix, not a state to leave.

## Problem

五ハーネスで「どのモデルで動くか」を一つの表として追跡していなかった。実測（2026-09-23）: Claude Code = Claude（OAuth 直）、Codex = `gpt-5-codex`（`config.toml`、古い ID）、pi = `proxy/main`、DSH = `localhost:4000`、omp = 設定は `anthropic/claude-fable-5` だが Anthropic OAuth の refresh token が失効（`invalid_grant`）し、omp は認証の通る唯一のプロバイダ openai-codex に落ちて gpt-5.5 を使っていた。測定（LiteLLM の Prometheus）にも載らない。

## Decision

- Claude Code → Claude、Codex → OpenAI。ベンダー製ハーネスはベンダーのモデル。
- pi・DSH・omp → LiteLLM の tier だけ（`main` / `complex` / `deterministic`）。プロバイダ直結の設定は置かない。
- omp: `domains/dev/config/omp/models.yml` にプロバイダ `proxy`（`http://localhost:4000/v1`、`apiKey: LITELLM_API_KEY`）、`config.yml.template` の `modelRoles` は全部 `proxy/*`（default / smol / tiny / commit / task → `main`、slow / plan / advisor → `complex`）。鍵は pi と同じく zsh の `omp()` ラッパーが `proxy-key.sh` で一度解決して渡す。
- omp の subagent 表（`agents/models.json` の `omp`）: sonnet・haiku → `proxy/main`、opus → `proxy/complex`（codex 表と同じ考え方）。
- 持ち主の追記（未裁定）: 「Codex も Codex 以外のモデルを使えるはず」— Codex の一部を LiteLLM 経由にするかは別件で grill。

## Alternatives considered

- **omp を Anthropic OAuth に再ログインさせて据え置く**: 第三者ハーネスがサブスクの OAuth を使う可否がベンダー方針に依存し、失効が再発する。調査記録: Anthropic は 2026-01 に opencode で Claude Max の OAuth を使った利用者を BAN し、opencode 側は「anthropic legal demanded we respond … their ToS prohibits using your claude max subscription outside of claude code」とクローズしている（https://github.com/anomalyco/opencode/issues/6930 ）。公式に認めるのは Agent SDK 経由だけで、それも 6/15 に pause（https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan ）。今回の `invalid_grant` は omp 自身の並行 refresh 競合（https://github.com/can1357/oh-my-pi/issues/5396 ）でも BAN でも同じ文字列になり判別できない。持ち主の方針（ベンダー製以外は LiteLLM）にも反する。却下。
- **五ハーネス全部を LiteLLM 経由**: Claude Code と Codex はサブスク（OAuth）で動き、API 課金に変わる。持ち主が「違和感がない」と明言した現状を変える理由が無い。却下。

## Consequences

- omp の主モデルが DeepSeek（`main`）になり、Claude ではなくなる。omp で Claude を使いたい場面は `complex` の中身（`litellm/config.yaml`）で決める。
- omp の `review` / `scout`（omp の文書に無い role 名）は消え、文書にある role（default / smol / tiny / commit / task / slow / plan / advisor）だけを使う。
- `~/.omp/agent/config.yml` はテンプレートの複製なので、次の `make update`（template pass）で置き換わる。
- Codex の `config.toml` の `model = "gpt-5-codex"` は古い ID のまま。Codex のモデルと「Codex で他モデル」は別件の grill。
- omp の無言フォールバックは仕様: `findInitialModel` は「5. first available model」まで落ちる（https://github.com/can1357/oh-my-pi/blob/main/docs/models.md ）。`proxy` を足しても openai-codex の OAuth が omp に残っていれば、proxy が落ちた日はまた黙って gpt-5.5 に行く。**持ち主の手: omp の中で anthropic と openai-codex の認証を消す**（`/logout` 相当）。プロバイダが `proxy` だけなら、落ちたときは「no auth」で止まり、それが正しい失敗の見え方。
- pi は「No auto-fallback to another provider」が設計方針（https://github.com/earendil-works/pi/pull/8966 ）だが起動レースで 10 回中 4 回別モデルで起動する報告あり（https://github.com/earendil-works/pi/issues/8810 ）。pi の設定は `proxy` 一本なので今の構成では落ち先が無い。
- 記録: `rules/research/2026-09-23-model-routing-per-harness.md`。
- 振り分け: 同日夜の裁定 `2026-09-23-tier-fixed-main-subagent-escalation.md` で上書き — セッションは一つの tier に固定（`main`）、`complex` は subagent、`/tier` は人の選択。pi / omp の拡張は保持だけを行い、プロンプトごとの判定は削除。
- 2026-09-24: omp の `proxy` ブロックは手書きをやめ `policy/tiers.json` から生成（`jig apply --target omp` の tiers 半分、`models.yml` の `# BEGIN jig:tiers` 区間）。手書き版は `contextWindow` / `maxTokens` を持たず omp の既定 128,000 / 16,384 が効いていた（omp docs/models.md の既定値）。正しくは main / complex = 1,000,000（DeepSeek 文書 https://api-docs.deepseek.com/quick_start/pricing の「1M」）、deterministic = 131,072（LM Studio でロードした qwen3.8-27b の窓、[unverified: 実機のロード設定と要照合]）。pi / DSH は以前から同じ源。Claude Code / Codex はベンダーのモデルで各自の窓。
- 未実測: omp から `proxy/*` を実際に叩いた結果（compat 設定が要るか — pi は `supportsDeveloperRole: false` / `maxTokensField: max_tokens` を指定している）。

## Sources

- omp の provider 設定: https://github.com/can1357/oh-my-pi/blob/main/docs/models.md（`apiKey` は「Value is first treated as an environment variable name」、role は default / smol / slow / vision / plan / commit / tiny / task / advisor）
- LiteLLM の tier 定義: `domains/dev/config/litellm/config.yaml`、`domains/dev/config/litellm/README.md`「Point a harness at it」
- 先行の裁定: `2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`（jig の tier は `localhost:4000` のまま）

# ハーネス別モデルルーティング調査 — サブスクOAuth vs ゲートウェイ

作成日: 2026-09-23

## 対象の問い

五つのハーネス（Claude Code / Codex CLI / omp = oh-my-pi / pi / DSH）がそれぞれ別方式でメインモデルを選んでいる現状に対し、以下を四方向（ベンダー・実践者・測定・実態）で調べる。

1. サードパーティハーネス（omp, pi, opencode 等）は Claude Max/Pro のサブスク OAuth トークン、または ChatGPT サブスクの OAuth トークン（Codex 用）を自分の API 呼び出しに使ってよいか。
2. 複数ハーネスを併用する実践者は何をしているか（一本のゲートウェイか、サブスク優先＋ゲートウェイ併用か）。
3. omp と pi は既定プロバイダの認証が失敗したとき、サイレントに他プロバイダへフォールバックするか。
4. サブスク OAuth 対 API キー経由ゲートウェイのコスト/レイテンシの実測比較はあるか。

## 検証方法と凡例

- 「直接取得」= curl で生 HTML/JSON を取得し own tag strip で本文を確認した箇所（要約なし）。
- 「要約経由」= WebFetch（要約モデル経由）で取得した箇所。マークして区別する。
- 「到達不能」= 403 / JS チャレンジ等で内容を確認できなかった箇所。
- WebSearch は本セッションの割当を使い切っていたため（"this session has used its web search budget"）、このセッションでは一切使用できず、`gh api` / `curl` による GitHub API 直叩きと WebFetch（個別 URL 指定）のみで調査した。`gh` CLI 自体は本サンドボックスの TLS 証明書問題（`tls: failed to verify certificate: x509: OSStatus -26276`）で使えず、認証なしの `curl https://api.github.com/...` に切り替えた（認証なしなので GitHub コードサーチ API は 401 で使えず、issue/repo サーチと個別 issue/PR 取得のみで代替）。

---

## 1. ベンダー（Anthropic / OpenAI / omp・pi 自身のドキュメント）

### Anthropic の Consumer Terms of Service（直接取得、Effective October 8, 2025）

URL: https://www.anthropic.com/legal/consumer-terms

生 HTML を取得しタグを除去した本文から、関連条項を verbatim 引用する。

> "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."

> "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else."

つまり Consumer ToS の文面上は、API キー経由か「明示的に許可された」経路以外での自動化・スクリプトアクセスを禁止している。「明示的に許可」の範囲が Claude Code だけなのか、他クライアントにも及ぶのかはこの条文単体では確定しない。

### Anthropic ヘルプセンター「Use Claude Code with your Pro or Max plan」（直接取得、ページ内表記 "August 19, 2026"）

URL: https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan

この記事は Claude Code（公式ターミナル/IDE 拡張）とそのサブスク接続のみを扱う。サードパーティクライアントへの言及はない。関連記事として "Use the Claude Agent SDK with your Claude plan" へのリンクがある。

### Anthropic ヘルプセンター「Use the Claude Agent SDK with your Claude plan」（直接取得、ページ内表記 "June 16, 2026"）

URL: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan

これが本問いに対する最も直接的な一次情報。verbatim 引用：

> "Update June 15: We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription's usage limits."

> "What the credit covers ... Third-party apps that authenticate with your Claude subscription through the Agent SDK"

> "For Team and Enterprise admins ... Production automation at scale. The Agent SDK monthly credit is sized for individual experimentation and automation. Teams running shared production automation should use Claude Platform with an API key for predictable pay-as-you-go billing."

つまり Anthropic は「Agent SDK 経由でサブスク認証するサードパーティアプリ」の存在を公式に認め、課金上の扱い（毎月クレジット、Pro $20〜Max 20x $200）まで制度化しようとしていた。ただし 2026-06-15 に一旦停止（pause）されており、"We're working to update the plan to better support how users build with Claude subscriptions" と、まだ確定した制度ではないと明言している。

**重要な限定**: この許可は「Claude **Agent SDK**（`@anthropic-ai/claude-agent-sdk` 等の公式 SDK）経由」のアプリに対するものであり、omp/pi のように独自に `anthropic-messages` ワイヤプロトコルを実装して OAuth トークンだけを流用するクライアントが同じ扱いを受けるかは、この記事からは確認できない。omp の `docs/models.md` は `anthropic-messages` を数ある `api` 値の一つとして列挙しており（Anthropic 公式 SDK の import ではなく独自実装と見られる）、この差異は **[未検証]** として明記する。

### Anthropic Commercial Terms（要約経由 WebFetch）

URL: https://www.anthropic.com/legal/commercial-terms

要約によれば「Customer may not and must not attempt to (a) access the Services to build a competing product or service ... or resell the Services except as expressly approved by Anthropic」「(b) reverse engineer or duplicate the Services」という条項があるが、これは API ビジネス利用者向けで、個人サブスクの話ではないとされる。

### 実際の運用（エンフォースメント）: 2026年1月、opencode ユーザーの Claude Max BAN 連鎖

これは規約の文言だけでなく、Anthropic が実際に行動した一次資料である。

- opencode（現 anomalyco/opencode、209,533 stars）issue #6930「Using opencode with Anthropic OAuth violates ToS & Results in Ban」（作成 2026-01-05, クローズ 2026-02-19）
  URL: https://github.com/anomalyco/opencode/issues/6930
  報告者本人の記述（直接取得）：
  > "I logged in via the OAuth method as suggested on Open Code's website and upon upgrading from Claude Max 5 to Claude Max 20, I think I triggered some kind of review and they banned my account. I reached out to several Anthropic engineers on Twitter and discovered that using Claude in this way on Open Code violates their terms of service and results in a ban."

  このイシューのクローズ直前、opencode 側（コメント末尾の署名等から opencode の開発者本人と見られる投稿）の verbatim コメント：
  > "anthropic legal demanded we respond to this issue and close it — i can't speak for their internal policies on who they ban and when, but their ToS prohibits using your claude max subscription outside of claude code. their docs have been recently updated to make this even more restrictive"

  この一文は「Anthropic の法務チームから直接コンタクトがあった」「ToS は Claude Code 以外での Max サブスク利用を禁止している」という、omp/pi ではなく opencode という別プロジェクトについてだが、同じ構造（サードパーティ CLI が Claude Max OAuth を横流しする）への Anthropic 側の実際の反応として直接的に関連する。

- 同じ問題は Anthropic 自身の公式リポジトリにも記録が残る。`anthropics/claude-code` issue #17118「[Feature Request] Support for OpenCode and Max plan」（作成 2026-01-09、クローズ **同日** 2026-01-09T19:26:31Z、5時間弱で決着）
  URL: https://github.com/anthropics/claude-code/issues/17118
  報告者の verbatim：
  > "Blocking use of Max plan with Opencode will almost certainly result in me downgrading or cancelling outright as I find other models which do support Opencode."

  コメント欄には "No Opencode = No Claude Subscription" 等、反発するユーザーの声が並ぶが、Anthropic 側の公式コメントはこの issue 内には見当たらない（直接取得で確認したコメント一覧に Anthropic 職員の発言なし）。

- opencode issue #7410「Broken Claude Max」（作成 2026-01-09、上記 claude-code#17118 と同日）
  URL: https://github.com/anomalyco/opencode/issues/7410
  コメント欄（直接取得、複数ユーザーの実体験）：
  > "Same. Downgraded my claude plan to $100 immediately because I won't be able to use it as much without opencode. Honestly using CC is like going back to stone age. ... I've cancelled my Anthropic subscription completely."

  > "@arthur404dev technically, this has nothing to do with anthropic. I don't believe we are supposed to be able to use the max plan outside of anthropic tools the way we are."

  他ユーザー：
  > "I finally got my ban lifted. For anyone else affected reach out to known employees on X. ... Love oh-my-open code but need to use the API key not OAuth which makes it prohibitively expensive!"

  （"oh-my-open code" は omp 系プラグインを指すと見られるが、正確な対象は特定できない。**[未検証]**。ここでの要点は「BAN 後に API キー課金へ切り替えたら『法外に高い』と感じた」という定性的コスト証言であり、数値は出ていない。）

このスレッドはあくまで opencode（別プロジェクト）の話であり、omp や pi が同種の BAN を受けたという一次資料は見つかっていない（後述 §3 参照。ただし omp 自身が抱える `invalid_grant` はこの BAN とは別の、omp 自身の実装バグに起因するもので、原因を混同しないこと）。

### OpenAI: Codex CLI と ChatGPT サブスク認証

OpenAI のヘルプセンター（`help.openai.com/en/articles/11989085*`）と `openai.com/policies/*` はいずれも本セッションから **到達不能**（`help.openai.com` は WebFetch で 403、`openai.com/policies/*` は curl で JS チャレンジページのみ返却 = "Enable JavaScript and cookies to continue"）。よって OpenAI 公式ページの verbatim 引用は取得できなかった。

代わりに、`openai/codex`（OpenAI 公式リポジトリ、126,090 stars、2025-04-13 作成、本日 09:15 UTC プッシュ）の README（直接取得）から：

> "Run `codex` and select **Sign in with ChatGPT**. We recommend signing into your ChatGPT account to use Codex as part of your Plus, Pro, Business, Edu, or Enterprise plan."

これは ChatGPT サブスク認証が Codex CLI（OpenAI 公式クライアント）向けであることを述べるのみで、サードパーティクライアントでの再利用に対する明示的な許可も禁止も書いていない。

未解決・未回答の一次資料として、`openai/codex` issue #36886「Is there a documented auth contract for third-party clients using a ChatGPT subscription with the Responses API?」（作成 2026-08-04、**open のまま**、公式回答なし）：

> "There's no equivalent for a ChatGPT subscription, because that credential isn't valid against `api.openai.com`. The only reachable host is the one the CLI itself uses ... This works today ... But it works by observation, not by contract."

> "2. **An explicit "no"**: subscription credentials are for first-party clients; third parties should use a platform API key. That's a completely reasonable answer and I'd implement to it immediately. Right now the absence of a statement is the problem, not the answer itself."

同様に issue #41664「docs: clarify whether codex-lb-style multi-account ChatGPT-auth proxies are supported」（作成 2026-08-30、open）も OpenAI の Terms of Use の該当条項を引用しつつ明確化を求めているが、maintainer からの実質的な回答はコメント欄になし（直接取得で確認：自動ラベル付けボットと投稿者本人のフォローアップのみ）。issue 内で引用されている OpenAI Terms of Use の文言：

> "The current individual Terms of Use say that users may not share account credentials or make an account available to someone else, and may not circumvent rate limits or restrictions."

**結論として**: OpenAI は Anthropic と異なり、サブスク OAuth のサードパーティ利用について公式な「可否の明言」も「専用 SDK 経由なら許可」という制度も、少なくとも本調査で到達できた資料の範囲では確認できなかった。「反応が薄いまま二つの issue が open で放置されている」こと自体が、この経路が公式にサポートされていないことを示す弱い間接証拠になる。

### omp（oh-my-pi）自身のドキュメントの姿勢

`can1357/oh-my-pi`（32,884 stars、2025-12-31 作成、本日 08:13 UTC プッシュ、open issues 3,041）の README（直接取得）は、Anthropic OAuth・OpenAI Codex OAuth を「Frontier APIs」の一部として **堂々と一次機能** として列挙している：

> "Anthropic `oauth` · OpenAI · OpenAI Codex `oauth` · ..."
> "Auth tags below: `oauth` signs in with your provider account, `plan` routes through a coding-plan subscription, `local` runs against a local server with the key optional."

つまり omp は Anthropic/OpenAI のサブスク OAuth 再利用をリスクとして注意書きすることなく、標準機能として実装・宣伝している。ToS 面のリスクについての言及は README・`docs/` 内で見つからなかった（`docs/auth-broker-gateway.md`, `docs/models.md` を精読したが ToS リスクへの言及なし）。

### pi（earendil-works/pi、旧 badlogic/pi-mono）自身のドキュメントの姿勢

`earendil-works/pi`（108,711 stars、2025-08-09 作成、本日 07:57 UTC プッシュ、open issues わずか 224）の `packages/coding-agent/docs/providers.md`（直接取得）は多数のプロバイダの OAuth ログインを汎用的に説明するのみで、Anthropic/OpenAI サブスクを特別扱いしたり ToS 注意を書いたりはしていない。

> "Most hosted providers support one or both of these authentication methods: Sign in through a browser or device flow backed by OAuth. Provide an API key."

pi の README（直接取得）自体は権限・サンドボックスの話（"Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access."）はしているが、ToS リスクについては言及していない。

**注**: pi は 2025-08-09 に作成されたリポジトリだが、"New issues and PRs from new contributors are auto-closed by default" という運用方針（README 冒頭）があるため、open issue 数の少なさ（224 件）は「問題が少ない」ではなく「新規投稿者のイシューが自動クローズされる運用」による見かけ上の低さである可能性が高い。**[推測、要検証]**。

---

## 2. 実践者（複数ハーネス運用者の実例）

### nmc-costa/dotfiles（named practitioner、GitHub 実名アカウント）

PR #13「Add dtx-providers-tui: configurador de harnesses + custom model providers」（マージ済み 2026-09-18）
URL: https://github.com/nmc-costa/dotfiles/pull/13

このユーザーは実際に複数ハーネス（opencode / Crush / Codex CLI / Claude Code / Gemini CLI）を並行運用しており、方式は「一本のゲートウェイ」と「ハーネスごとの直接アダプタ」の **併用**：

> "Codex CLI e Claude Code passam por um proxy LiteLLM local compartilhado; Gemini CLI falha explicitamente por não ter mecanismo nenhum para isso hoje."
> （Codex CLI と Claude Code は共有ローカル LiteLLM プロキシを経由する。Gemini CLI は今のところそのための仕組みが一切ないため明示的に失敗する。）

つまり実践者の実例でも「全ハーネスに単一の方式」ではなく、ハーネスの対応状況によって方式が割れている（LiteLLM ゲートウェイ経由が使えるハーネスと、使えないハーネスが混在）。

同じユーザーの PR #12「Fix global agent symlinks to file-level (security: whole-dir risked leaking credentials)」（マージ済み 2026-09-17）は否定的教訓：
URL: https://github.com/nmc-costa/dotfiles/pull/12

> "`setup_agent_symlinks(\"claude\")` whole-directory-symlinked `~/.claude` (Claude Code's live state dir: `.credentials.json`, sessions, logs, caches) into the git working tree. `.gitignore`'s ... entries don't cover `.credentials.json` or several other runtime files — a real path to committing credentials."

サブスク OAuth トークンをファイルとして dotfiles 管理する場合、ディレクトリ単位のシンボリックリンクは認証情報の誤コミットに直結するという実務上の負の証拠。

### LiteLLM（BerriAI/litellm、59,455 stars、2023-07-27 作成、本日 09:01 UTC プッシュ）自身の実装

これは「実践者」というより「広く使われるゲートウェイ製品自身が採用したパターン」だが、業界標準の可視化として重要。PR #40319「feat(cli): add `lite configure claude` and `lite unconfigure claude`」（マージ済み 2026-09-10）
URL: https://github.com/BerriAI/litellm/pull/40319

LiteLLM が公式に整備した経路は、**Claude Code 自身が持つ `ANTHROPIC_BASE_URL` / `apiKeyHelper` の上書き機構** を使って Claude Code をプロキシに向けるもので、Anthropic のサブスク OAuth トークンをよそのクライアントで横流しする方式ではない：

> "`lite configure claude --api-key KEY` patches settings.json in place, turns on gateway model discovery ... Without `--api-key` it uses your `lite login` through apiKeyHelper, the same path `lite login --config-claude` takes"

そして、この方式固有の実務上のつまずき（測定に近い定性情報）：

> "Claude Code requests its own model ids for sub-agents and background helpers, which 400 on a proxy that does not serve them"
> "Claude Code treats an auto-router group name as an unknown model: it prints `unrecognized_model`, assumes a 200k window, and sends no thinking params for it."

つまり「ゲートウェイに乗せる」場合でも、Claude Code 側がサブエージェント/バックグラウンド用に決め打ちで要求するモデル ID をゲートウェイ側に用意しないと 400 になる、という具体的な失敗モードが実装レベルで報告されている。

### can1357（omp の作者、named practitioner）のブログ（要約経由 WebFetch、2026-02-12 公開、`stencil.so/blog/the-harness-problem`）

主題はエディットツールのフォーマット比較で本問いとは別だが、本文中の一文が該当：

> "Anthropic recently blocked OpenCode, a massively popular open-source coding agent, from accessing Claude through Claude Code subscriptions."

これは §1 の opencode BAN 事件（2026年1月）を、omp の作者自身が「(Anthropicは) 最近 OpenCode をブロックした」と公然と言及している一次資料であり、omp の作者がこのリスクを認識した上で omp に Anthropic OAuth 機能を実装し続けている、という構図を裏付ける。

---

## 3. サイレントフォールバック: omp と pi の実装・issue

### omp（oh-my-pi）: ドキュメント化された「意図的な」フォールバックと、ドキュメント化された既知バグの両方がある

`docs/models.md`（直接取得）「Initial model selection priority」節：

> "`findInitialModel(...)` uses this order: 1. explicit CLI provider+model 2. first scoped model (if not resuming) 3. saved default provider/model 4. known provider defaults (e.g. OpenAI/Anthropic/etc.) among available models 5. first available model"

および：

> "`getAvailable()` filters to models that are keyless or have resolvable auth. So a model can exist in registry but not be selectable until auth is available."

つまり **設定した既定プロバイダの認証が失効すると `getAvailable()` から外れ、`findInitialModel` は 5 段階目「first available model」まで自動的にフォールバックする** — これが今回ユーザーが遭遇した「`anthropic/claude-fable-5` が使えず `openai-codex → gpt-5.5` に落ちた」の正体で、omp としては**仕様として明文化された動作**である。ただしこのフォールバックが起きたこと自体をユーザーに知らせる警告の記述は `models.md` 内にはない。

`docs/auth-broker-gateway.md`（直接取得）「Background refresher」節、ユーザーが遭遇したエラーメッセージとの一致：

> "**definitive failures** (`invalid_grant`, `invalid_token`, `revoked`, unauthorized refresh-token, 401/403 not from a network blip) — credentials are passed to `AuthStorage.credentials.disable(id, cause)` so the next snapshot pull surfaces a clean delete on the client"

そして、この正確な原因を突き止めた issue #5396「Provider OAuth (Anthropic) credential permanently disabled ~daily by concurrent usage-poller refresh on single-use refresh tokens」（作成 2026-07-14、クローズ 2026-07-16）
URL: https://github.com/can1357/oh-my-pi/issues/5396

これはユーザーが遭遇した **`invalid_grant: Refresh token not found or invalid` という文字列と完全一致するエラー** を報告した issue で、原因が Anthropic 側の BAN ではなく **omp 自身の実装バグ**（複数プロセスが Anthropic の「使い捨て」リフレッシュトークンを同時にリフレッシュしようとして競合し、片方が握っていたトークンが無効化される）であると特定している：

> "Root cause is two interacting defects in the OAuth credential lifecycle... Anthropic OAuth refresh tokens are single-use (each refresh returns a new refresh token and invalidates the previous one)... a background usage-probe `invalid_grant` permanently disables the whole credential, even when the access token is still valid"

このバグは #9073（"durably disable dead OAuth credential generations"）等で部分的に修正されたが、関連する回帰が issue #9194（作成 2026-08-21、クローズ済み）「OAuth preflight discards the peer-rotated outcome of #disableDefinitiveOAuthFailure — freshly rotated credential is stranded and resolve fails with no auth」として再発している。**つまりこのクラスの不具合は2026年7月から8月にかけて繰り返し発生しており、直っては別の経路で再発する状態にある。**

さらに、この「サイレントフォールバック」自体が omp のコードベース全体で繰り返し報告される構造的な問題であることも確認できた（Auth に限らない）：

- issue #12350「bug(models): role set to a newly pulled Ollama model silently falls back; bare 'omp models refresh' doesn't refresh ollama」（作成 2026-09-17、open）
  URL: https://github.com/can1357/oh-my-pi/issues/12350
  > "OMP exited 0, and it printed no warning ... It should not fall back without a message."

- issue #11494「share --gist silently falls back to the share server when gh is missing or fails, and the output never says so」（作成 2026-09-10、open）
  URL: https://github.com/can1357/oh-my-pi/issues/11494
  > "An explicit flag, silently renegotiated ... This is the false-success shape: the output reports the operation, not the operation *as degraded*."

これらは認証とは別サブシステムだが、「exit 0 で警告なしに別のものへ黙って切り替わる」という設計上のクセが omp に複数箇所存在することを示す。

### pi: 「自動フォールバックしない」ことが明示的な設計方針だが、バグとして意図せず起きている

`earendil-works/pi` の PR #8966「fix(coding-agent): --provider without --model selects that provider's default; auth failures name the failing provider」（作成 2026-09-01、**merged: null = 未マージ**、状態 open として要確認）
URL: https://github.com/earendil-works/pi/pull/8966

このPRの説明文に、pi の設計思想が明記されている：

> "`prepareRequest` now wraps request-time auth failures: the message names the provider/model, states it's an auth failure, lists other configured providers, and suggests `--provider <name>`. The original error is preserved on `cause`. **No auto-fallback to another provider is introduced.**"

> "### Motivation\nHit in production: one expired `openai-codex` refresh token made the whole CLI appear dead — `-p` runs exited with `{\"code\":\"refresh_token_reused\"}` even when explicitly pointing at a different, healthy provider, because `--provider` alone was a no-op and the error never named its source."

つまり pi のメンテナ（このPRの作者）は「認証が壊れたら **黙って** 他プロバイダに切り替える」のではなく「**どのプロバイダで何が壊れたかを名指しして止まる**」ことを明確な設計原則として掲げている。omp とは逆方向の設計判断である。

しかし実際には、この原則に反する silent fallback がバグとして複数報告されている：

- issue #9884「Configured default model is sometimes replaced by a fallback at startup」（作成 2026-09-22、open、直近）
  URL: https://github.com/earendil-works/pi/issues/9884
  > "In 4 of 20 startups the session began with `deepseek/deepseek-v4-pro` instead. That model is not the configured default; it is the built-in fallback"

- issue #8810「Extension-registered providers: fresh sessions intermittently ignore defaultProvider/defaultModel and start on another provider's default」（作成 2026-08-29、open）
  URL: https://github.com/earendil-works/pi/issues/8810
  > "pi silently falls back to another provider's default model (`defaultModelPerProvider`) — in our case `google/gemini-3.1-pro-preview`, which our Google credential (free tier, quota `limit: 0`) cannot serve, so the first request fails with a 429."
  > 実測: "~4 of 10 sessions start on the wrong model" — 10回起動して4回で誤動作という定量的再現率まで報告されている。
  > "Expected behavior ... If the configured provider cannot be resolved yet, pi should say so explicitly instead of silently starting on an unrelated provider's default model."

このように、pi は**設計としては「認証失敗時に他プロバイダへ黙って切り替えない」ことを志向しているが、拡張機構（`pi.registerProvider`）まわりの起動時レースコンディションによって、意図に反したサイレントフォールバックが実際には発生している**、というのが実態である。omp のように「fallback は仕様」ではなく、pi では「fallback はバグ」という位置付けの違いは明確。

`packages/coding-agent/docs/models.md`（pi、直接取得）は `/model` ピッカーの挙動として：

> "The picker shows models whose providers have usable authentication."

とのみ書かれており、起動時の自動フォールバックについての説明はドキュメントレベルでは存在しない（settings.md に `defaultProvider`/`defaultModel` の設定項目はあるが、フォールバック動作自体はドキュメント化されていない）。

---

## 4. 測定された証拠（コスト・レイテンシ比較）

サブスク OAuth 対 API キー経由ゲートウェイの、コーディングエージェント用途での定量的なコスト/レイテンシ比較ベンチマークは、本調査で到達できた資料の範囲では **見つからなかった**。

見つかったのはいずれも定性的な証言のみ：

- opencode #7410 コメント（直接取得）: BAN 後に API キー課金へ切り替えた元ユーザーが「need to use the API key not OAuth which makes it prohibitively expensive」（「法外に高い」）と述べる — 金額の提示なし。
- 同issue: 別ユーザーが「Downgraded my claude plan to $100 immediately」（Max から $100 プランへダウングレード）と述べる — これは BAN 後の対応行動の記述であり、コスト比較の測定ではない。

LiteLLM PR #40319 はコスト面ではなく「プロキシ経由で Claude Code を動かすと 400 エラーになるモデル ID の不一致」という技術的な失敗モードの記述であり、金額・レイテンシの数値は含まない。

**測定レンズでの結論: 「確認できなかったこと」に計上する。**

---

## 5. 横断まとめ表

| 出典 | タスク種別 | 結果 | コスト数値 | 名指しされた失敗モード |
|---|---|---|---|---|
| Anthropic Consumer ToS (2025-10-08 施行、直接取得) | 規約 | 自動化アクセスは API キーか「明示的許可」限定 | なし | — |
| Anthropic "Agent SDK with your Claude plan" (2026-06-16 更新、6/15 一時停止、直接取得) | 規約/課金制度 | サードパーティ (Agent SDK 経由) のサブスク認証を公式に認知・課金設計 | Pro $20〜Max 20x $200/月クレジット（停止中） | 制度自体が pause 中で未確定 |
| opencode issue #6930 / #7410、claude-code issue #17118（直接取得） | 実運用 BAN | 2026年1月、Claude Max OAuth を opencode で使ったユーザーが大量 BAN | なし（定性的な「$100へダウングレード」等の言及のみ） | ToS違反によるアカウント停止、法務部門の介入 |
| openai/codex issue #36886 / #41664（直接取得） | 規約明確化要求 | 未回答のまま open、公式な可否表明なし | なし | 「観察による動作であって契約ではない」 |
| omp `docs/models.md` / `auth-broker-gateway.md`（直接取得） | 実装ドキュメント | 認証失敗時「first available model」へ意図的にフォールバック | なし | 警告なしの黙示フォールバックが複数箇所で既知バグ化（#12350, #11494） |
| omp issue #5396（直接取得） | 実装バグ報告 | `invalid_grant` は omp 自身の並行リフレッシュ競合が原因と特定 | なし | 複数プロセスでの Anthropic single-use refresh token 競合 |
| pi PR #8966（直接取得） | 設計方針 | 「サイレントな自動フォールバックを導入しない」と明言 | なし | 失敗プロバイダを名指しするエラーへ変更 |
| pi issue #9884 / #8810（直接取得） | 実装バグ報告 | 設計方針に反し、拡張プロバイダ登録のレースでサイレントフォールバックが発生 | なし | 10回中4回、意図しないモデルで起動（実測比率） |
| nmc-costa/dotfiles PR #13 / #12（直接取得） | 実践者ログ | LiteLLM 一本化 + ハーネス別直結の併用、`.claude` 丸ごとシンボリックリンクで認証情報漏洩リスク | なし | ディレクトリ単位シンボリックリンクによる認証情報コミット寸前 |
| BerriAI/litellm PR #40319（直接取得） | 実装ログ | Claude Code を LiteLLM に向ける公式パターンは `ANTHROPIC_BASE_URL`/`apiKeyHelper` 上書き（OAuth 横流しではない） | なし | サブエージェント/バックグラウンド用モデルIDがプロキシに無いと 400 |
| can1357 ブログ（要約経由） | 実践者コメント | 「Anthropic は最近 OpenCode をブロックした」と明言 | なし | — |

---

## 6. 確認できなかったこと

- OpenAI 公式ページ（`openai.com/policies/usage-policies/`, `openai.com/policies/terms-of-use/`, `help.openai.com/en/articles/11989085*`）の生テキスト — いずれも JS チャレンジまたは 403 で本文を取得できなかった。openai/codex issue 内で引用された断片のみ確認。
- Anthropic Agent SDK の「pause」がその後（6/16以降）どう決着したか、最新の制度状態。取得した記事は「pause」時点で止まっている。
- omp・pi それぞれが opencode と同様の BAN を Anthropic から直接受けた一次資料。「omp 自身が BAN された」という報告は見つからず、omp の `invalid_grant` 系 issue はすべて omp 自身の実装バグに帰着していた（BAN と実装バグの両方が同じエラー文字列を出しうるため、ユーザーの今回の事象がどちらなのかはこの調査だけでは判定できない）。
- サブスク OAuth と API キー経由ゲートウェイのコスト・レイテンシを定量比較したベンチマーク、論文、リーダーボードの類。
- DSH（DeepSeek Harness）についての一次資料。今回の四方向調査は omp・pi・Claude Code・Codex CLI に集中しており、DSH 固有のフォールバック実装は調べられていない。
- Codex CLI（openai/codex）自身のフォールバック実装ドキュメント・コード（今回は認証契約の有無の調査に絞り、omp/pi と同水準のコード精読はしていない）。
- WebSearch が使用不能だったため、業界ブログ・ニュース記事の横断検索ができていない。WebFetch（個別URL指定）と GitHub API のみでの調査であり、検索エンジンで見つかる一次資料の取りこぼしがありうる。

---

## 7. 結論（推奨はしない、証拠が支持する範囲のみ）

Anthropic は「Claude サブスクをサードパーティクライアントで使う」こと自体を一律禁止してはいない — 公式の Claude Agent SDK 経由であれば、2026年6月時点で課金制度（毎月クレジット）まで用意しようとしていた一次資料がある（ただし6月15日に pause され未確定）。しかし Consumer ToS の文言（「API キーか明示的許可がない限り自動化アクセス禁止」「認証情報の共有禁止」）は解釈の余地を残しており、実際に2026年1月、Claude Code 以外のクライアント（opencode）で Max サブスクの OAuth を使っていたユーザーが大量に BAN される事件が起き、opencode 側は Anthropic の法務部門から直接連絡を受けて「ToS は Claude Code 以外での Max 利用を禁止している」と公にクローズコメントで認めている。omp・pi 自身が同種の BAN を受けたという一次資料は見つからなかったが、omp は README でこの Agent/Codex OAuth 機能を注意書きなしに一次機能として宣伝しており、リスクは実装者(can1357)自身が自分のブログで opencode の事例に言及するほど認知されている。OpenAI 側は Anthropic よりさらに曖昧で、サードパーティによる ChatGPT サブスク認証利用について「動くが契約ではない」状態が2026年8月時点でも続き、公式な可否表明を求める issue が複数 open のまま放置されている。実践者の実例では「全ハーネスに単一ゲートウェイ」でも「サブスク優先+ゲートウェイ併用」でもなく、ハーネスごとに対応状況が違うため方式が自然に割れる（LiteLLM のようなゲートウェイ自体も、OAuth トークンの横流しではなく Claude Code 公式の `ANTHROPIC_BASE_URL` 上書き機構を使うのが業界の作法として定着している）。フォールバック挙動については omp と pi で設計思想が対照的で、omp は「認証が切れたら黙って次に使える any モデルへ」が明文化された仕様（かつ関連するサイレントフォールバックのバグ報告が認証以外の subsystem にも複数存在する）であるのに対し、pi は「サイレントな自動プロバイダ切り替えを導入しない」ことを明示の設計方針として掲げつつも、拡張プロバイダ登録のレースコンディションに起因する意図しないサイレントフォールバックが実測で10回中4回という頻度でバグ報告されている。今回のユーザーの `invalid_grant: Refresh token not found or invalid` というエラー文字列は、omp 自身のドキュメントが「definitive failure」として分類し、かつ omp の issue #5396 が「Anthropic の使い捨てリフレッシュトークンに対する omp の並行アクセスバグ」として原因特定した文字列と完全一致するため、これが Anthropic 側の ToS エンフォースメントなのか omp 自身の実装バグなのかは、この調査の範囲では判別できない — 両方が同じエラー文字列を返しうる、という点が重要な留保である。コスト・レイテンシの定量比較データは、四方向のどこにも見つからなかった。

# どの作業をどのモデルで動かすか：tier名で書き、作業の種類で割り当て、別のモデルへは黙って落とさない

Status: accepted — 持ち主の裁定（2026-10-18〜19）。五つの問い（モデルの書き方、作業とtierの対応、障害時の切り替え、`deterministic`の名前、effortの書き方）を一つずつ調べて決めた。`2026-09-23-tier-fixed-main-subagent-escalation.md`のDecisionにあるtier名`deterministic`（`/tier deterministic`）も、この記録で`executor`（`/tier executor`）に置き換える

rule: Agent definitions name a model only as a tier — `main`, `complex` or `executor` — or not at all (then the agent inherits its parent's model and effort); jig's one mapping table (`agents/models.json`) turns a tier into each harness's concrete model, and an unknown tier or effort word is an error, never a silent fallback. Route work by kind: design, planning, hard debugging and security review go to `complex`; everyday work, implementation, exploration, general review and light tasks stay on `main`; `executor` (the local model, formerly `deterministic`) is used only when the plan is fully specified, the result is machine-checkable, and keeping the work local matters more than speed — it is never a default. Effort is `low`, `medium`, `high`, `xhigh` or `max`: planning `xhigh`, debugging and reviews `high`, exploration and plan execution `medium`, titles and commit messages `low`, implementation inherits, and `max` is never a default; a level the model lacks drops to the nearest lower one and is logged. When a model is unavailable, retry in one layer only, then try another deployment of the same model, and never switch to a different model automatically — stop with an error naming the deployment and the cause, and show which deployment answered.

## Problem

モデルの選び方が6か所でばらばらに決まり、食い違っていた（2026-10-18の棚卸し）。

- 自前のエージェント38個は`model:`をClaudeのモデル名（sonnet 36・opus 1・haiku 1）で書き、`agents/models.json`がCodexではOpenAIのモデルに、ompではtierに読み替えていた。ローカルのtierを指す名前が無く、`fable`は表に無かった。
- 強い格（`complex`）に上がるのはメール整理役の`chief-of-staff`だけだった。`opus`は2026-04にeverything-claude-codeから取り込んだときの値が残っていただけで、計画役の`architect`は2026-08-03の作り直し（039c7e42）で理由の記録なく`sonnet`に下がっていた。
- 委任の規則（`rules/common/60-delegation.md`）は「サブエージェントは安いモデル」、tierの決定は「強いモデルはサブエージェント経由」と、向きが逆だった。
- `deterministic`は四つの意味（設計済みの計画の実行、機械的な作業、再現性・オフライン、LLMを使わない実行）で使われ、実際のモデルは温度1で動いていた。
- effortはどのエージェントにも書かれず、Codex向けだけClaudeのモデル名から推測していた。LiteLLMはDeepSeekへの`reasoning_effort`の段階を捨て、`main`と`complex`は常にDeepSeekの既定（high）で動いていた（LiteLLMの`deepseek/chat/transformation.py`の読み取り。送って確かめてはいない）。
- 障害時は、ローカルのtierだけ同じモデルの2か所目（Mac）に回り、クラウドのtierは設定なし、ompは既定で10回やり直して別モデルへの切り替えも有効と、層ごとにばらばらだった。

## Decision

### 1. モデルはtier名で書き、具体名は表1か所に置く

- エージェントの`model:`は`main`・`complex`・`executor`のどれか。書かなければ親と同じモデルとeffortを使う。
- ハーネスごとの具体名は`agents/models.json`だけに書く（Claude Code: complex→opus・main→sonnet、Codex: complex→sol・main→luna、pi・omp・DSH: `proxy/<tier>`）。`executor`はClaude CodeとCodexでは各社の一番安いモデルに割り当てる。
- 表に無いtier名・effortの言葉はエラーにする。Claude Codeへもリンクをやめてjigが書き出す。
- 外部パックのエージェントに別のハーネス用のモデル名が書いてあれば、表に無い限り捨てる（自前のエージェントには適用しない）。パックのエージェントごとのtierは`source.json`で割り当てられるようにする。

### 2. 作業の種類でtierを割り当てる

| 作業 | tier | effort |
|---|---|---|
| 設計・計画 | complex | xhigh |
| 難しいデバッグ | complex | high |
| セキュリティレビュー | complex | high |
| 一般・言語別のレビュー | main | high |
| 判断を伴う実装 | main | 書かない（親と同じ） |
| 探索・検索 | main | medium |
| 決まった計画の実行 | main（条件を満たすときだけexecutor） | medium |
| 題名・コミット文・圧縮 | main | low |

- ompの役割: default・task・smol・tiny・commit → main、slow・plan・advisor・designer → complex。visionはmainのモデルが画像を読めるかを確かめてから決める。
- `executor`は三つの条件をすべて満たす作業だけに使う：計画が細部まで決まっている、成否を機械で確かめられる、速さより外に出さないことを優先したい。どこの既定にもしない。使って成功率を測り、広げるかを決める。
- セッションのtierは起動時に決め、途中で自動では変えない（09-23の決定のまま）。強いモデルへは`model: complex`のエージェントに任せて上がる。

### 3. effortの段階は五つ

- `low`・`medium`・`high`・`xhigh`・`max`。モデルに無い段階はすぐ下に下げ、記録する（DeepSeekのxhigh → high、Qwenのhigh・max → xhigh）。
- `max`は既定にしない。本体のセッションのeffortは持ち主の設定（high）のまま。
- LiteLLMがDeepSeekへの段階を捨てる件は直し、段階が届くことを送って確かめる。

### 4. 使えないときは、同じモデルの別経路までにする

- やり直しは1か所の層でだけ行う。次に同じモデルの別の置き場所へ回す。
- 別のモデルへは自動で切り替えない。両方だめなら、どの置き場所が何のエラーで止まったかを書いて止める。
- 実際に答えた置き場所（`x-litellm-model-api-base`）をステータスラインと記録に出す。
- `executor`の2か所（Linuxのllama-server、MacのLM Studio）は文脈の長さをそろえる。両方止まってもクラウドには逃がさない（使う理由が「外に出さない」なので）。
- `main`・`complex`は、障害の頻度をLiteLLMの記録で測ってから、同じモデルの2つ目の経路を足すか決める。

### 5. `deterministic`を`executor`に改める

役割（決まった計画を実行する）を名前にする。古い名前は別名として残さず、エラーにする。

## Alternatives considered

- **Claudeのモデル名を格付けとして使い続ける**: ローカルのtierを指せず、Anthropicの都合で意味が動き（Claude Code 2.1.73・2.1.274でクラウド経由の`opus`が古いモデルに解決された）、外部パックの`model: opus`が別のハーネスで存在しないモデルに解決される事故がある（omp #7966）。却下。
- **作業の種類名（explore・implement・plan）をエージェントに書く**（Ampの考え方）: 種類→tier→モデルと2段の変換になり、複数ハーネスでの前例が無い。tierを作業の種類で定義すれば同じ利点が得られる。却下。
- **モデルを書かせない（全員が親と同じ）**: 強いモデルへ上げる経路も下げる経路もなくなる。却下。
- **一般のレビューもcomplexにする**: 強いモデルのほうがバグを多く見つけるという測定が無く（唯一の比較ではHaiku 4.5がSonnet 4.6と同等以上、F1 0.365対0.343）、約25個を上げると費用が大きく増える。セキュリティだけ上げる。
- **effortを4段階（xhighなし）にする**: pstackの既定、Ampのoracle、公開されているCodex設定の3割、Stetの測定（xhighでレビュー通過69% 対high 38%）がxhighを使う。却下。
- **障害時に同じ格の別のモデルや別の格へ切り替える**: キャッシュが外れ（当たる率95% 以上から3〜18%、omp #13106）、設定の誤りが切り替え先の成功に隠れ（LiteLLM #44815）、気づかないまま別モデルで処理が続く（Claude Code #94652）。却下。
- **`executor`が止まったらクラウドへ逃がす**: 会話と手元のコードが外へ出る（OpenCode #52333の型）。使う理由が崩れる。却下。
- **名前を`local`にする**: 将来クラウドの安いモデルを実行役にすると、また食い違う。却下。

## Consequences

- `agents/models.json`の鍵がtier名になり、38個のエージェントの`model:`を書き換える。architectはcomplex、chief-of-staffはmainに戻る。
- Claude Codeのエージェントはjigが書き出す形に変わる。
- `deterministic`はLiteLLMの設定、tierの定義、Swarm、omp・pi・DSHの設定、環境変数の値、Grafana、dotctl、llama-serverの設定まで、約30ファイルで`executor`に変わる。`2026-09-27-deterministic-falls-back-to-the-mac.md`と`2026-09-27-model-catalog-and-tier-assignment.md`の名前は「事実」として更新する。
- `rules/common/60-delegation.md`の「サブエージェントは安いモデル」は、場面ごとに引けるモデル選択のガイドに置き換える。
- effortの欄を各ハーネスに書き出す（Claude Code `effort`、Codex `model_reasoning_effort`、omp・pi `thinking`）。

## Sources

- 調査は2026-10-18〜19にこのセッションで行い、記録はチャットに残した（一回きりの調査記録は作らない）。主な一次資料：
- Claude Codeのサブエージェントとモデル設定: https://code.claude.com/docs/en/sub-agents 、https://code.claude.com/docs/en/model-config
- ompの役割と優先順位: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/task-agent-discovery.md 、https://github.com/can1357/oh-my-pi/issues/7966
- AmpのrushとDial: https://ampcode.com/news/rush-2.0 、https://ampcode.com/news/the-dial
- aiderのarchitect/editor: https://aider.chat/2024/09/26/architect.html
- effortの測定: https://artificialanalysis.ai/models/comparisons/claude-opus-5-high-vs-claude-opus-5-medium 、https://www.stet.sh/blog/gpt-55-codex-graphql-reasoning-curve
- pstackのeffortの方針: https://github.com/cursor/plugins （`pstack/skills/poteto-mode/SKILL.md`）
- 障害時の失敗例: https://github.com/BerriAI/litellm/issues/44815 、https://github.com/can1357/oh-my-pi/issues/13106 、https://github.com/anthropics/claude-code/issues/94652 、https://github.com/anomalyco/opencode/issues/52333
- コードレビューのモデル比較: https://arxiv.org/html/2606.15689v1

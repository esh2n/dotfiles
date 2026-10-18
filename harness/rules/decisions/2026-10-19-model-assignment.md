# どの作業をどのモデルで動かすか：tier 名で書き、作業の種類で割り当て、別のモデルへは黙って落とさない

Status: accepted — 持ち主の裁定（2026-10-18〜19）。五つの問い（モデルの書き方、作業と tier の対応、障害時の切り替え、`deterministic` の名前、effort の書き方）を一つずつ調べて決めた

rule: Agent definitions name a model only as a tier — `main`, `complex` or `executor` — or not at all (then the agent inherits its parent's model and effort); jig's one mapping table (`agents/models.json`) turns a tier into each harness's concrete model, and an unknown tier or effort word is an error, never a silent fallback. Route work by kind: design, planning, hard debugging and security review go to `complex`; everyday work, implementation, exploration, general review and light tasks stay on `main`; `executor` (the local model, formerly `deterministic`) is used only when the plan is fully specified, the result is machine-checkable, and keeping the work local matters more than speed — it is never a default. Effort is `low`, `medium`, `high`, `xhigh` or `max`: planning `xhigh`, debugging and reviews `high`, exploration and plan execution `medium`, titles and commit messages `low`, implementation inherits, and `max` is never a default; a level the model lacks drops to the nearest lower one and is logged. When a model is unavailable, retry in one layer only, then try another deployment of the same model, and never switch to a different model automatically — stop with an error naming the deployment and the cause, and show which deployment answered.

## Problem

モデルの選び方が 6 か所でばらばらに決まり、食い違っていた（2026-10-18 の棚卸し）。

- 自前のエージェント 38 個は `model:` を Claude のモデル名（sonnet 36・opus 1・haiku 1）で書き、`agents/models.json` が Codex では OpenAI のモデルに、omp では tier に読み替えていた。ローカルの tier を指す名前が無く、`fable` は表に無かった。
- 強い格（`complex`）に上がるのはメール整理役の `chief-of-staff` だけだった。`opus` は 2026-04 に everything-claude-code から取り込んだときの値が残っていただけで、計画役の `architect` は 2026-08-03 の作り直し（039c7e42）で理由の記録なく `sonnet` に下がっていた。
- 委任の規則（`rules/common/60-delegation.md`）は「サブエージェントは安いモデル」、tier の決定は「強いモデルはサブエージェント経由」と、向きが逆だった。
- `deterministic` は四つの意味（設計済みの計画の実行、機械的な作業、再現性・オフライン、LLM を使わない実行）で使われ、実際のモデルは温度 1 で動いていた。
- effort はどのエージェントにも書かれず、Codex 向けだけ Claude のモデル名から推測していた。LiteLLM は DeepSeek への `reasoning_effort` の段階を捨て、`main` と `complex` は常に DeepSeek の既定（high）で動いていた（LiteLLM の `deepseek/chat/transformation.py` の読み取り。送って確かめてはいない）。
- 障害時は、ローカルの tier だけ同じモデルの 2 か所目（Mac）に回り、クラウドの tier は設定なし、omp は既定で 10 回やり直して別モデルへの切り替えも有効と、層ごとにばらばらだった。

## Decision

### 1. モデルは tier 名で書き、具体名は表 1 か所に置く

- エージェントの `model:` は `main`・`complex`・`executor` のどれか。書かなければ親と同じモデルと effort を使う。
- ハーネスごとの具体名は `agents/models.json` だけに書く（Claude Code: complex→opus・main→sonnet、Codex: complex→sol・main→luna、pi・omp・DSH: `proxy/<tier>`）。`executor` は Claude Code と Codex では各社の一番安いモデルに割り当てる。
- 表に無い tier 名・effort の言葉はエラーにする。Claude Code へもリンクをやめて jig が書き出す。
- 外部パックのエージェントに別のハーネス用のモデル名が書いてあれば、表に無い限り捨てる（自前のエージェントには適用しない）。パックのエージェントごとの tier は `source.json` で割り当てられるようにする。

### 2. 作業の種類で tier を割り当てる

| 作業 | tier | effort |
|---|---|---|
| 設計・計画 | complex | xhigh |
| 難しいデバッグ | complex | high |
| セキュリティレビュー | complex | high |
| 一般・言語別のレビュー | main | high |
| 判断を伴う実装 | main | 書かない（親と同じ） |
| 探索・検索 | main | medium |
| 決まった計画の実行 | main（条件を満たすときだけ executor） | medium |
| 題名・コミット文・圧縮 | main | low |

- omp の役割: default・task・smol・tiny・commit → main、slow・plan・advisor・designer → complex。vision は main のモデルが画像を読めるかを確かめてから決める。
- `executor` は三つの条件をすべて満たす作業だけに使う：計画が細部まで決まっている、成否を機械で確かめられる、速さより外に出さないことを優先したい。どこの既定にもしない。使って成功率を測り、広げるかを決める。
- セッションの tier は起動時に決め、途中で自動では変えない（09-23 の決定のまま）。強いモデルへは `model: complex` のエージェントに任せて上がる。

### 3. effort の段階は五つ

- `low`・`medium`・`high`・`xhigh`・`max`。モデルに無い段階はすぐ下に下げ、記録する（DeepSeek の xhigh → high、Qwen の high・max → xhigh）。
- `max` は既定にしない。本体のセッションの effort は持ち主の設定（high）のまま。
- LiteLLM が DeepSeek への段階を捨てる件は直し、段階が届くことを送って確かめる。

### 4. 使えないときは、同じモデルの別経路までにする

- やり直しは 1 か所の層でだけ行う。次に同じモデルの別の置き場所へ回す。
- 別のモデルへは自動で切り替えない。両方だめなら、どの置き場所が何のエラーで止まったかを書いて止める。
- 実際に答えた置き場所（`x-litellm-model-api-base`）をステータスラインと記録に出す。
- `executor` の 2 か所（Linux の llama-server、Mac の LM Studio）は文脈の長さをそろえる。両方止まってもクラウドには逃がさない（使う理由が「外に出さない」なので）。
- `main`・`complex` は、障害の頻度を LiteLLM の記録で測ってから、同じモデルの 2 つ目の経路を足すか決める。

### 5. `deterministic` を `executor` に改める

役割（決まった計画を実行する）を名前にする。古い名前は別名として残さず、エラーにする。

## Alternatives considered

- **Claude のモデル名を格付けとして使い続ける**: ローカルの tier を指せず、Anthropic の都合で意味が動き（Claude Code 2.1.73・2.1.274 でクラウド経由の `opus` が古いモデルに解決された）、外部パックの `model: opus` が別のハーネスで存在しないモデルに解決される事故がある（omp #7966）。却下。
- **作業の種類名（explore・implement・plan）をエージェントに書く**（Amp の考え方）: 種類→tier→モデルと 2 段の変換になり、複数ハーネスでの前例が無い。tier を作業の種類で定義すれば同じ利点が得られる。却下。
- **モデルを書かせない（全員が親と同じ）**: 強いモデルへ上げる経路も下げる経路もなくなる。却下。
- **一般のレビューも complex にする**: 強いモデルのほうがバグを多く見つけるという測定が無く（唯一の比較では Haiku 4.5 が Sonnet 4.6 と同等以上、F1 0.365 対 0.343）、約 25 個を上げると費用が大きく増える。セキュリティだけ上げる。
- **effort を 4 段階（xhigh なし）にする**: pstack の既定、Amp の oracle、公開されている Codex 設定の 3 割、Stet の測定（xhigh でレビュー通過 69% 対 high 38%）が xhigh を使う。却下。
- **障害時に同じ格の別のモデルや別の格へ切り替える**: キャッシュが外れ（当たる率 95% 以上から 3〜18%、omp #13106）、設定の誤りが切り替え先の成功に隠れ（LiteLLM #44815）、気づかないまま別モデルで処理が続く（Claude Code #94652）。却下。
- **`executor` が止まったらクラウドへ逃がす**: 会話と手元のコードが外へ出る（OpenCode #52333 の型）。使う理由が崩れる。却下。
- **名前を `local` にする**: 将来クラウドの安いモデルを実行役にすると、また食い違う。却下。

## Consequences

- `agents/models.json` の鍵が tier 名になり、38 個のエージェントの `model:` を書き換える。architect は complex、chief-of-staff は main に戻る。
- Claude Code のエージェントは jig が書き出す形に変わる。
- `deterministic` は LiteLLM の設定、tier の定義、Swarm、omp・pi・DSH の設定、環境変数の値、Grafana、dotctl、llama-server の設定まで、約 30 ファイルで `executor` に変わる。`2026-09-27-deterministic-falls-back-to-the-mac.md` と `2026-09-27-model-catalog-and-tier-assignment.md` の名前は「事実」として更新する。
- `rules/common/60-delegation.md` の「サブエージェントは安いモデル」は、場面ごとに引けるモデル選択のガイドに置き換える。
- effort の欄を各ハーネスに書き出す（Claude Code `effort`、Codex `model_reasoning_effort`、omp・pi `thinking`）。

## Sources

- 調査は 2026-10-18〜19 にこのセッションで行い、記録はチャットに残した（一回きりの調査記録は作らない）。主な一次資料：
- Claude Code のサブエージェントとモデル設定: https://code.claude.com/docs/en/sub-agents 、https://code.claude.com/docs/en/model-config
- omp の役割と優先順位: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/task-agent-discovery.md 、https://github.com/can1357/oh-my-pi/issues/7966
- Amp の rush と Dial: https://ampcode.com/news/rush-2.0 、https://ampcode.com/news/the-dial
- aider の architect/editor: https://aider.chat/2024/09/26/architect.html
- effort の測定: https://artificialanalysis.ai/models/comparisons/claude-opus-5-high-vs-claude-opus-5-medium 、https://www.stet.sh/blog/gpt-55-codex-graphql-reasoning-curve
- pstack の effort の方針: https://github.com/cursor/plugins （`pstack/skills/poteto-mode/SKILL.md`）
- 障害時の失敗例: https://github.com/BerriAI/litellm/issues/44815 、https://github.com/can1357/oh-my-pi/issues/13106 、https://github.com/anthropics/claude-code/issues/94652 、https://github.com/anomalyco/opencode/issues/52333
- コードレビューのモデル比較: https://arxiv.org/html/2606.15689v1

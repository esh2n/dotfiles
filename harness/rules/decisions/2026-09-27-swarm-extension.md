# Swarmはomp・piの拡張として自分で持ち、実行系を持たない決めごとの例外にする

Status: superseded by 2026-10-19-swarm-on-native-subagents.md（自作の実行系を退役し、pstackのswarmの手順と各ハーネスの本体のサブエージェントで組む。上限と費用を見せる要件は、各ハーネスの上限の設定とLiteLLMの台帳、常に見える一覧で引き継ぐ） — accepted — 持ち主の裁定（2026-09-27）。09-13から求められていたSwarmを、09-13と09-22の調査で見送りにしていた。`2026-09-22-subagents-and-workflows-by-scale.md`の「jig itself has no execution engine」と`2026-09-22-loop-native-goal.md`の「Never build a custom loop/execution engine」に、この拡張だけの例外を足す（両記録のほかの部分は変えない）

rule: The Swarm extension for omp and pi is the one exception to "no custom execution engine": it spawns worker agents as headless harness processes that talk to LiteLLM by tier name, keeps its own queue with a concurrency limit (per tier; `deterministic` has one slot), and shows every worker in an always-visible table below the editor — name, model, effort, status (working, queued, unread, done, failed), progress, idle, age, note, cost and tokens. It never runs unattended loops (goal features still own those), never lets workers write the same files at once without isolation, and never hides cost: the concurrency cap and the running cost are always on screen.
scope: repo

## Problem

要件: @voidwarriorchanの自作Swarm（kimi-cli風、Astraハーネス）と同等以上の体験をpi・ompで使えること。二枚の画面写真で分かった形は、入力欄の下に常に出る表（NAME / MODEL / EFFORT / STATUS / PROGRESS / IDLE / AGE / NOTE）で、状態にWorking・Queued・Unreadがあり、18人を同時に動かしている。

ompの本体（v18.3.4のソース）は子を並行に動かせるが、上限を超えて待つ子はどの画面にも出ず、拡張が子の状態（モデル・費用・トークン）を受け取る公開APIは起動時の一回だけで、常に出る一覧は動いている子の名前だけ（ompのAgent Hub: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md 、拡張API: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md ）。piの本体にはSwarmが無く、拡張のpi-agent-teamsは6月から止まり、piごと落ちる不具合が放置されている（https://github.com/tmustier/pi-agent-teams/issues/50 、https://github.com/tmustier/pi-agent-teams/issues/9 ）。表示だけを足す形では、この画面は作れない。

## Decision

- **Swarmは拡張として自分で持つ。** 作業役を起こし、待たせ、見せる部分を、ompとpiの拡張に置く。作業役は画面を持たないハーネスのプロセスとして起こし、tier名でLiteLLMに話させる。
- **これは09-22の「実行系を持たない」の例外で、この拡張だけに限る。** 無人の繰り返し（goal）は今までどおり各ハーネスのgoal機能が持つ。jigは実行系を持たないまま。
- **上限と費用は最初から画面に出す。** 09-22の決めごとの理由（自作のオーケストレーターは放置・失敗が多く、費用が見えないまま膨らむ）への対策として、同時に動かす人数の上限（tierごと、`deterministic`は1）と、作業役ごと・合計の費用とトークンを常に表に出す。
- **同じファイルを同時に書かせない。** 同じ作業場所で動かすときは担当の範囲を分け、分けられないときは作業場所を隔離する。

作り方の細部（どちらのハーネスから、子の起こし方、作業場所、結果の返し方、状態の保存）は、この記録の下で仕様を一つ書いて決める。

## Alternatives considered

- **ompの本体の子とAgent Hubを使い、表示だけを足す**: 待つ子が見えず、拡張が子のモデル・費用を受け取れないので、手本の表が作れない（ompのAgent Hub / 拡張API: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md 、https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md ）。取り下げた。
- **pi-agent-teamsを入れる**: 6月から更新が止まり、親のタイマーがpiごと落とすissue #50と、作業の跡が1か月で2.2GB溜まるissue #9が放置。却下。
- **herdrのペインに作業役を並べる**: 手本の人が「そこから抜け出して楽になった」形そのもの。却下。
- **Kimi Codeをそのまま使う**: pi・ompとjigの配線（ガード、フォーマット、tier）から外れ、9月までCtrl+CでCLIごと落ちる・再起動で一覧が戻らない不具合があった。却下。

## Consequences

- 実行系を一つ保守することになる。09-13のgraph-ideal（ブランチ`feat/graph-ideal-form`）の表示部分は流用を検討する。
- 費用の上限と同時数の上限は、この拡張の設定として持ち、画面に出す。
- ompの`task`の入力欄は2リリース続けて作り直されているので、ompの内部には依存せず、公開された拡張APIとプロセスの起動だけに頼る。

## Sources

- Kimi Code（手本にしたSwarm実装）: https://github.com/MoonshotAI/kimi-code 、https://www.kimi.ai/blog/agent-swarm
- omp Agent Hub: https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md
- pi-agent-teams（6月から停止、issue #50・#9放置）: https://github.com/tmustier/pi-agent-teams
- 持ち主が貼った @voidwarriorchanの画面写真2枚（2026-09-27）

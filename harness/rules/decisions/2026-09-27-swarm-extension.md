# Swarm は omp・pi の拡張として自分で持ち、実行系を持たない決めごとの例外にする

Status: accepted — 持ち主の裁定（2026-09-27）。09-13 から求められていた Swarm を、09-13 と 09-22 の調査で見送りにしていた。`2026-09-22-subagents-and-workflows-by-scale.md` の「jig itself has no execution engine」と `2026-09-22-loop-native-goal.md` の「Never build a custom loop/execution engine」に、この拡張だけの例外を足す（両記録のほかの部分は変えない）

rule: The Swarm extension for omp and pi is the one exception to "no custom execution engine": it spawns worker agents as headless harness processes that talk to LiteLLM by tier name, keeps its own queue with a concurrency limit (per tier; `deterministic` has one slot), and shows every worker in an always-visible table below the editor — name, model, effort, status (working, queued, unread, done, failed), progress, idle, age, note, cost and tokens. It never runs unattended loops (goal features still own those), never lets workers write the same files at once without isolation, and never hides cost: the concurrency cap and the running cost are always on screen.

## Problem

要件: @voidwarriorchan の自作 Swarm（kimi-cli 風、Astra ハーネス）と同等以上の体験を pi・omp で使えること。二枚の画面写真で分かった形は、入力欄の下に常に出る表（NAME / MODEL / EFFORT / STATUS / PROGRESS / IDLE / AGE / NOTE）で、状態に Working・Queued・Unread があり、18 人を同時に動かしている。

omp の本体（v18.3.4 のソース）は子を並行に動かせるが、上限を超えて待つ子はどの画面にも出ず、拡張が子の状態（モデル・費用・トークン）を受け取る公開 API は起動時の一回だけで、常に出る一覧は動いている子の名前だけ。pi の本体には Swarm が無く、拡張の pi-agent-teams は 6 月から止まり、pi ごと落ちる不具合が放置されている（`rules/research/2026-09-27-swarm-on-omp-pi.md`）。表示だけを足す形では、この画面は作れない。

## Decision

- **Swarm は拡張として自分で持つ。** 作業役を起こし、待たせ、見せる部分を、omp と pi の拡張に置く。作業役は画面を持たないハーネスのプロセスとして起こし、tier 名で LiteLLM に話させる。
- **これは 09-22 の「実行系を持たない」の例外で、この拡張だけに限る。** 無人の繰り返し（goal）は今までどおり各ハーネスの goal 機能が持つ。jig は実行系を持たないまま。
- **上限と費用は最初から画面に出す。** 09-22 の決めごとの理由（自作のオーケストレーターは放置・失敗が多く、費用が見えないまま膨らむ）への対策として、同時に動かす人数の上限（tier ごと、`deterministic` は 1）と、作業役ごと・合計の費用とトークンを常に表に出す。
- **同じファイルを同時に書かせない。** 同じ作業場所で動かすときは担当の範囲を分け、分けられないときは作業場所を隔離する。

作り方の細部（どちらのハーネスから、子の起こし方、作業場所、結果の返し方、状態の保存）は、この記録の下で仕様を一つ書いて決める。

## Alternatives considered

- **omp の本体の子と Agent Hub を使い、表示だけを足す**: 待つ子が見えず、拡張が子のモデル・費用を受け取れないので、手本の表が作れない（`rules/research/2026-09-27-swarm/omp-internals.md`）。取り下げた。
- **pi-agent-teams を入れる**: 6 月から更新が止まり、親のタイマーが pi ごと落とす issue #50 と、作業の跡が 1 か月で 2.2GB 溜まる issue #9 が放置。却下。
- **herdr のペインに作業役を並べる**: 手本の人が「そこから抜け出して楽になった」形そのもの。却下。
- **Kimi Code をそのまま使う**: pi・omp と jig の配線（ガード、フォーマット、tier）から外れ、9 月まで Ctrl+C で CLI ごと落ちる・再起動で一覧が戻らない不具合があった。却下。

## Consequences

- 実行系を一つ保守することになる。09-13 の graph-ideal（ブランチ `feat/graph-ideal-form`）の表示部分は流用を検討する。
- 費用の上限と同時数の上限は、この拡張の設定として持ち、画面に出す。
- omp の `task` の入力欄は 2 リリース続けて作り直されているので、omp の内部には依存せず、公開された拡張 API とプロセスの起動だけに頼る。

## Sources

- `rules/research/2026-09-27-swarm-on-omp-pi.md` と同じ名前のディレクトリの記録
- 持ち主が貼った @voidwarriorchan の画面写真 2 枚（2026-09-27）

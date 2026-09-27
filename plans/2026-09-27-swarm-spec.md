# Swarm 拡張の仕様（pi・omp）

決定: `harness/rules/decisions/2026-09-27-swarm-extension.md`。調査: `harness/rules/research/2026-09-27-swarm-on-omp-pi.md` と `2026-09-27-swarm/`。持ち主の裁定（2026-09-27）: 両方に入れる（共通の中身＋薄い差し込み口二つ）／裏で動かし、結果はまとめて届け、それまでは未読／作業は今のチェックアウトを直接、範囲が重なる仕事は順番待ち、隔離が要るときだけ `.claude/worktrees/<名前>` に同名のブランチ、戻すのは持ち主が決めたときに普通の git で、新しいコマンドは作らない。

## 1. 形

- **親が呼ぶ道具 `swarm`**（pi・omp の `registerTool`）。`action` は次の四つ。
  - `start`: `items` の配列を受け取り、すぐ返す（名前と状態だけ）。一件は `{ name, task, tier?, effort?, files?, isolated? }`。`tier` は省略時に親の tier、`effort` は `--thinking` の段階（省略時は tier の既定）、`files` は触ってよい範囲（glob）、`isolated` は worktree で隔離するか。
  - `status`: 表と同じ中身を文字で返す。
  - `results`: 終わった作業役の最終回答を返し、未読を既読にする。
  - `cancel`: 名前を指定して止める（省略時は全員）。
- **作業役**は親と同じハーネスを画面なしで起こす: `pi --mode json …` / `omp --mode json …`、`--model proxy/<tier>`、`--thinking <effort>`。環境に `SWARM_WORKER=1`（作業役の中では `swarm` を登録しない＝入れ子を作らない）と `PI_TIER` / `OMP_TIER`（tier-router が tier を保つ）。jig のガード・整形・Stop の関門は、作業役にもそのまま効く。
- **状態**: `queued` → `working` → `unread`（終わった、親がまだ読んでいない）→ `done`。失敗は `failed`、隔離した作業役が終わったら `held`（合流待ち）。止めたら `cancelled`。
- **届け方**: 一度の `start` で起こした組が全員終わったとき、または誰かが失敗したときに、一通だけ親へ送る（`sendMessage`、`followUp`）。中身は各作業役の状態・要約・全文の置き場所。omp #13096（数秒ずれて終わると親が何度も起こされる）を避ける。
- **順番待ち**: 同時に動かす数の上限を tier ごとに持つ（`harness/policy/swarm.json`、持ち主が書くファイル。既定案 `main` 8、`complex` 4、`deterministic` 1、全体 32）。`files` が重なる二件は同時に動かさず、あとの一件を `queued` にする。`files` のない作業役は全体と重なるものとして扱う。
- **隔離**: `isolated: true` の作業役は `.claude/worktrees/<name>` にブランチ `<name>` で worktree を作り、そこで作業させ、終わったらそのブランチにコミットさせる。`.worktreeinclude` に書かれたファイル（`.env` など）だけを写す。`.claude/worktrees/` が無視されていないリポジトリでは `.git/info/exclude` に足す（コミットされる `.gitignore` は触らない）。戻すのは持ち主が決めたときに `git merge --no-ff <name>`、済んだら `git worktree remove` とブランチ削除。セッションの始めに、マージ済みのブランチの worktree だけを片付ける。
- **表**（入力欄の下、`setWidget` の `belowEditor`、10 行まで）: 見出し 1 行＋作業役の行（作業中・順番待ち・未読・失敗・済みの順、入りきらない分は「…ほか N 件」）＋合計の行。列は NAME / MODEL / EFFORT / STATUS / PROGRESS / IDLE / AGE / NOTE / COST / TOKENS。
  - PROGRESS は本当の割合が取れないので、同じ組の終わった作業役の所要時間の中央値に対する経過時間（95% で止める）。終わった作業役がまだいなければ帯を動かすだけ。
  - NOTE は `direct`、`worktree <name>`、失敗の理由、`合流待ち`。
  - COST と TOKENS は作業役の `message_update` の `usage`（pi は `cost` も持つ）。費用が 0 のまま取れないハーネスでは `—` と出し、隠さない。
- **記録**: 作業役ごとの出力の全文と、状態の変化を `~/.local/state/jig/swarm/<session>/` に JSONL で残す。親のセッションが終わるとき（`session_shutdown`）は、動いている作業役を止める（孤児を残さない）。

## 2. 置き場所と触るファイル

- 共通の中身: `harness/jig/src/domain/swarm/`（純粋: 状態、順番待ちと範囲の重なり、表の組み立て、pi/omp の JSON イベントの読み分け）と `harness/jig/src/app/swarm/`（作業役の起動と停止、worktree、記録、届け方）。
- pi の差し込み口: `home/shared/harness/pi/extensions/swarm.ts`（道具と表の登録だけ）。
- omp の差し込み口: `harness/jig/adapters/omp/src/swarm.ts` を `index.ts` から登録。
- 上限の設定: `harness/policy/swarm.json`（持ち主が書く。無ければ既定案の値）。
- worktree の手順のそろえ直し（同じ裁定）: スキル `using-git-worktrees` の「ハーネスのやり方を優先」を、どのハーネスでも `.claude/worktrees/<名前>` と同名のブランチに書き直す。

## 3. 範囲外

- 作業役への途中の指示（`steer`）と、作業役どうしの連絡（Kimi の Tower の連絡箱）。json モードで足りる範囲に絞る。
- 親のセッションをまたいだ再開（Kimi Code が 09-23 まで壊していた部分）。記録は残すが、再開はしない。
- 自動のマージ。
- Claude Code・Codex・DSH への Swarm（Claude Code には agent teams とワークフローがあり、裁定の範囲は pi・omp）。
- 費用を LiteLLM の記録から引く仕組み（ストリーミングの応答にはコストのヘッダが付かない。まずハーネスの `usage` で出し、0 のままなら後で直す）。

## 4. 確かめ方

- 単体: 状態の移り方、範囲の重なり（glob どうし）、tier ごとの上限、表の組み立て（幅、10 行、並び順、…ほか N 件）、pi と omp のイベントの読み分け（実際の出力を記録した見本で）。
- 結合: 偽の作業役（JSONL を吐く小さなスクリプト）で、起動・順番待ち・失敗・一通だけの届け・止める・後片付けを通す。worktree は一時リポジトリで作る・写す・片付ける。
- 実機（持ち主）: Omarchy と Mac で `OMP_TIER=main omp` と `pi` を開き、三件の仕事を `swarm` で起こして、表が出る・順番待ちが見える・届いた結果が読める、を見る。`deterministic` を二件にして、一件が `queued` になるのを見る。
- 静的な確認: `tsc --noEmit`、`biome check`、jig のテスト一式。

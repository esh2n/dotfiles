---
question: "pi で、検証つきの持続する目標と、無人の目標継続を得る正しい方法は何か。リポジトリ自前の拡張 gate.ts は今の pi でまだ動くか"
date: 2026-10-20
verdict: "gate.ts は 0.85.1 でも最新 1.3.0 でも読み込めて動く（exec の形も合う）が、検査コマンドが 5 分のタイムアウトで殺されると成功と判定される欠陥があり、無人の継続は元から持たない。pi 本体に goal 機能は無い。継続の足場は 0.87.0 で入った agent_before_settle。pi-goal 0.1.7 は 4 か月更新が無く、無限ループ報告が未解決で、画面なしでは使えない見込みが高い。今は gate.ts を直して残し、継続は agent_before_settle で足すのが根拠に最も合う"
unverified:
  - "gate.ts と pi-goal を実機で読み込んでの動作（pi を起動しない指示のため、型定義・ソース・Node の spawn の挙動からの読みだけ）"
  - "タイムアウト時に成功と判定される欠陥は、pi の exec 本体ではなく同じ Node の child_process の信号終了の挙動を別に走らせて確かめた"
  - "pi-goal 0.1.7 が pi 1.3.0 で動くか（ソースは読んだが読み込んでいない）"
  - "pi -p で pi-goal の継続が最後まで回るか（pi-goal の README に記述なし。別の拡張 pi-codex-goal は「終了前に止まりうる」と明記）"
  - "pi-goal 以外の goal 拡張 20 余りのうち、README を読んだのは 3 本だけ。シェルの終了コードによる検査を持つものがあるかは未確認"
  - "pi の内部 Issue トラッカー（earendil-works/pi）で goal や継続に関する要望の有無"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# pi で検証つきの持続する目標と無人の継続を得る方法

調査日 2026-10-20。対象はこのリポジトリの `home/shared/harness/pi/extensions/gate.ts`（HEAD `003326ab` の時点）。

## 方法と確かさの区分

- 直接読んだもの: npm レジストリの JSON（`npm view`）、`npm pack` で取った `@earendil-works/pi-coding-agent` 0.85.1 と 1.3.0 のパッケージ（型定義 `dist/core/extensions/types.d.ts`、`dist/core/exec.js`、`dist/core/extensions/runner.js`、`docs/`）、upstream の `packages/coding-agent/CHANGELOG.md`（raw、6329 行）、各リポジトリの README とソース、`gh` の API。
- 手元の確認: 導入済みの pi の `types.d.ts` は 0.85.1 のパッケージのものとバイト単位で同一だった（`diff -q`）。
- 要約を通したもの: なし（WebFetch は使っていない）。
- 到達できなかったもの: なし。ただし pi は起動していない（指示による）ので、実機の挙動は未検証と明記する。
- 偏り: npm 検索はキーワードに `goal` を持つ公開物の一覧で、品質も保守も保証しない。Issue は否定側に偏る。README は肯定側に偏る。

## 1. pi の版

### 手元（`which -a pi`）

| 順 | パス | 版 | 実体 |
|---|---|---|---|
| 1 | `~/.local/share/mise/installs/node/22/bin/pi` | 0.85.1 | mise の node 22 の global npm（`@earendil-works/pi-coding-agent`） |
| 2 | `/etc/profiles/per-user/<user>/bin/pi` | 0.87.1 | Nix の home-manager-path |
| 3 | `~/.local/share/mise/shims/pi` | 0.85.1 | mise の shim（1 と同じものを指す） |
| 4 | `~/.local/bin/pi` | 0.83.0 | 古い npm global（8 月 4 日の作成） |

`pi --version` は 0.85.1。シェルに `pi` 関数があり、`whence -p pi` で PATH の先頭（上の 1）を呼ぶ。つまり、同じ機械に 3 つの版（0.83.0、0.85.1、0.87.1）があり、Nix の 0.87.1 は PATH の順で負けている。

### npm の最新

`npm view @earendil-works/pi-coding-agent`: `latest` は 1.3.0（2026-10-15 公開）、`legacy-node20` は 0.74.2。`repository.url` は `git+https://github.com/earendil-works/pi.git`。

### badlogic/pi-mono は同じプロジェクトか

同じ。`gh api repos/badlogic/pi-mono` は `full_name: earendil-works/pi` を返す（移転のリダイレクト）。CHANGELOG にも旧名の記述が残る。「`pi update --self` now supports the upcoming package rename from `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent`」（CHANGELOG 0.7x 節、`https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md`）。リポジトリの最終 push は 2026-10-20 で、アーカイブされていない。

### 0.85.1 から 1.3.0 までの CHANGELOG（goal・継続・拡張 API）

`grep -i goal` の結果は 1 件だけで、圧縮要約の見出し（「Clear sections: Goal, Progress, Key Information, File Operations」）。goal 機能の記述はどの版にも無い。

拡張 API に関係する変更（出典は上と同じ CHANGELOG）:

| 版 | 内容 | gate.ts への影響 |
|---|---|---|
| 0.86.0 | `user_bash` が失敗時に閉じる、カスタムプロバイダの入力形式の変更 | 無し（使っていない） |
| 0.87.0 | 破壊的: `shouldStopAfterTurn` を削除し `finishTurn` に。`turn_end` と `agent_before_settle` を「actionable boundary」に: 「Return `{ entries: [...event.entries, draft], continue: true }` to persist structural entries in order and ensure one next provider request」。`agent_settled` の再入を遅延 | 無し。ただし継続の足場として新しい |
| 0.87.0 | `ContextEditEntry` を `SessionEntry` に追加 | 無し |
| 1.0.0 | 既定が全画面 TUI | 無し |
| 1.2.0 | 破壊的: `before_agent_start` が `pi.sendMessage(..., { triggerTurn: true })` で始まる実行でも発火。`BeforeAgentStartEvent` は `messageType` の union に。実行の開始中も busy とみなす（`pi.sendUserMessage()` は `deliverAs` 必須） | gate.ts は `event` を読まず `message` を返すだけなので影響無し。自前の継続を足すなら `messageType === "user"` の判定が要る |
| 1.2.0 | print モード（`-p`）が出力上限で切れたとき exit 1 | 無人実行の検知に使える |
| 1.2.0 | 実験的な server/client/plugin を削除（公開物には入っていなかった） | 無し |

`registerCommand`、`registerTool`、`ui.setStatus` の署名は 0.85.1 と 1.3.0 で変わっていない（両版の `types.d.ts` を読んだ。`registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">)`、`setStatus(key: string, text: string | undefined)`）。ツールの `execute` の `ctx` 型が `ExtensionContext` から `ExtensionToolContext`（`ExtensionContext` を拡張）に変わっただけ。typebox は 0.85.1 が 1.3.7、1.3.0 が 1.3.27 の依存で、gate.ts の `import { Type } from "typebox"` は両方で解決する。Node は 1.3.0 が `>=22.19.0`。

## 2. 最新の pi に goal・継続の組み込み機能はあるか

無い。

- `docs/` を `grep -rn -i goal` した結果は `compaction.md`（要約の見出し）と `index.md`（紹介文）の 2 か所だけ（1.3.0 のパッケージ）。
- CHANGELOG に goal・自律継続の項目は無い（上記）。
- 本体が持つのは、継続のための拡張の足場だけ。`docs/extensions.md`: 「`agent_before_settle` is the final actionable boundary: it can append entries and request one continuation.」「Guard continuation conditions because an unconditional continuation can loop.」`agent_settled` は通知のみ。足場は 0.87.0 からで、0.85.1 には無い。
- 無人実行そのものは `pi -p`（print）、`--mode json`、`--mode rpc`。拡張は 4 モードすべてで読み込まれ、JSON と print には UI が無い（`docs/extensions.md`: 「Extensions load in interactive, RPC, JSON, and print modes... JSON and print modes have no UI.」）。

## 3. gate.ts の `exec` は今の型と合うか

結論: 合う。全 gate が失敗する、という事態にはならない。

### 型定義

0.85.1（`types.d.ts` 993 行）と 1.3.0（1280 行）で同一:

```
exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
```

`dist/core/exec.d.ts`（両版で同一）:

- `ExecOptions`: `signal?`、`timeout?`（ミリ秒）、`cwd?`
- `ExecResult`: `{ stdout: string; stderr: string; code: number; killed: boolean }`

gate.ts は `r?.exitCode ?? r?.code ?? 0` と読むので、実際の `code` が使われる。`stdout`、`stderr` も一致。`(pi as any)` は型の上では不要だが、害は無い。`/bin/zsh` は `-lc` で `shell: false` の spawn に渡る（`exec.js`）ので、引数の渡し方も正しい。

### 欠陥: タイムアウトで殺された検査は成功になる

`exec.js` はタイムアウトで `proc.kill("SIGTERM")` を送り、終了時に `resolve({ stdout, stderr, code: code ?? 0, killed })` と返す。信号で終わった子プロセスの終了コードは `null` なので、`code` は 0、`killed` は true になる。`child-process.js` の `onExit` は `exitCode = code` をそのまま渡す。確かめ: 同じ構成の `spawn("/bin/zsh", ["-lc", "sleep 5"])` に SIGTERM を送ると `exit null SIGTERM` が出た（Node、手元で実行）。

gate.ts の `run()` は `killed` を見ない。`GATE_TIMEOUT_MS`（5 分）を超えた検査は `code: 0` で返り、`r.code !== 0` に当たらないので、検査が通ったことになる。つまり、遅い検査（長いテスト）ほど「通った」と判定され、目標が閉じる。これは 0.85.1 でも 1.3.0 でも同じ。修正は `r.killed` を失敗として扱う一行。

その他に読んだ点:
- 状態はモジュールの変数に持ち、`session_start` で毎回初期化する。再開や新規セッションで目標と gate が消える（コードから読んだ。継続の根拠にはならない）。
- 継続を持たない。目標は `before_agent_start` で、ユーザーが送るプロンプトのたびに差し込まれるだけで、モデルがターンを終えれば止まる。`goal_complete` はモデルが呼ばない限り gate を走らせない。この設計の制約で、バグではない。

## 4. 起源 earlyaidopters/marks-pi-harness

- 現状: 2026-08-10 作成、最終 push も同日（2026-08-10T21:34Z）。★15、Issue/PR は 1 件（モデルの glob の修正、クローズ済み）。`gh repo view` と commits API。アーカイブはされていない。
- 2026-09-13（取り込み日）以降の変更: 無い。最終 push が取り込みより前。`extensions/gate.ts` の履歴は初回コミット（2026-08-10T15:38:38Z）の 1 件だけ。
- 内容: 起源の `gate.ts` は 120 行で、`registerCommand("goal")`、`registerCommand("gate")`、`registerTool` の `goal_complete`、`(pi as any).exec("/bin/zsh", ["-lc", cmd], { timeout })`、`r?.exitCode ?? r?.code ?? 0` まで同じ。つまり、欠陥（`killed` を見ない）は起源にもある。手元の版は整形と、`before_agent_start` の注入文の追加が主な差。
- 継続: 起源にも無い。README の説明は「ローカル LM Studio のモデル用の 14 拡張」。
- ライセンス: `LICENSE` は MIT、著作権表示は「Copyright (c) 2026 Early AI Dopters」。ただし `package.json` は `"license": "ISC"`（ルートの `package.json`）で食い違う。MIT の LICENSE ファイルが本文なので、gate.ts の冒頭コメントの「MIT」は LICENSE と合っている。
- 保守の見込み: 起源は 2 か月以上動いていない。upstream の変更を追う相手ではなく、gate.ts はこのリポジトリが持ち主。

## 5. Michaelliv/pi-goal と他の goal 拡張

### Michaelliv/pi-goal

- 版: npm の最新は 0.1.7（2026-06-21）。8 版、初版 2026-05-04。GitHub: ★234、MIT、最終 push 2026-06-21（約 4 か月前）。最後のコミットは「Allow create_goal to replace existing goals」。
- 対応する pi の版: `peerDependencies` は `@mariozechner/pi-coding-agent: "*"` と `@mariozechner/pi-tui: "*"`（旧スコープ）。`engines` は無し。README は版を書かない。pi の拡張ローダは旧スコープの import を束ねた実体に差し替える（`loader.js` に `"@mariozechner/pi-coding-agent": …`、0.85.1 と 1.3.0 の両方）ので読み込みは通る見込み（未実行）。Issue #5（2026-06-21、未解決）は「Migrate extension imports to @earendil-works packages」で、`pi update --extensions` が非推奨の旧パッケージを入れ、npm の警告が出ると報告。
- 継続の仕組み: `/goal` が目標をセッションの custom エントリに保存し、`agent_end` で `ctx.hasPendingMessages()` が無ければ `queueContinuation` が `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })` を出す（`.pi/extensions/pi-goal/index.ts` の `agent_end` ハンドラ、170〜176 行）。つまり、ターンの外から新しい実行を起こす形で、0.87.0 の `agent_before_settle`（同じ実行の中で継続する）は使っていない。
- 予算: `/goal --tokens 50k <目標>`。`turn_end` でトークンを数え、予算に達すると `budget_limited` にして最後のまとめのターンを出す。README: 「token-budget-limited」。
- 検証: モデルが `update_goal({ status: "complete" })` を呼べば完了。README: 「The model is instructed to audit completion against real evidence」。つまり自己申告で、コマンドの終了コードによる検査は無い。gate.ts が持つ「完了前に検査を通す」に当たるものが無い。
- 画面なし: README に記述なし。ソースは `ctx.ui.notify` を直接呼ぶ（画面が無いモードでは何もしない前提のはず、[unverified]）。print モードは `session.prompt()` の返りで終わる作りで（`print-mode.js` 105〜110 行、`waitForIdle` を呼ばない）、`agent_end` の後に起こした継続の実行が終わるまで待つ保証は読み取れない [unverified]。
- Issue（4 件、3 件が未解決）: #6「Gets stuck in an infinite loop sometimes」（2026-07-31、DeepSeek V4 Flash で `update_goal` が成功を返しても継続が同じ目標を入れ直す）。コメントで別の利用者が「the goal kept triggering, burning through over a billion tokens」と書き、待機機構つきの自作フォーク `Liucong-JunZi/pi-bettergoal` を案内。#7「Esc should stop goal not overflow context」（2026-08-13）。#5（上記）。
- 評価: 費用事故の報告が 1 件（予算を付けずに待ち続けた例）、未解決の Issue に 4 か月応答が無く、保守は止まっている。

### 他の保守されている pi 用 goal 拡張（npm と GitHub、2026-10-20）

`npm search keywords:pi-package goal` の 20 件超の一部。対応版は `peerDependencies`。

| 名前 | 版 | 更新 | pi の対応 | 備考 |
|---|---|---|---|---|
| `pi-codex-goal`（fitchmultz） | 0.6.1 | push 2026-10-20、★195、Issue 0 | README: 「Use Pi 1.0.0 or later and Node.js 24 or later」 | 完了は `update_goal`。`token_budget` を任意で、既定の下限 500,000。画面なし: 「`pi -p '/goal …'` runs the command and can change saved goals. Print mode can exit before the goal turn finishes and leave the goal paused.」（`/create-goal` あり） |
| `@pify/goal`（pifydev） | 0.10.0 | push 2026-10-14、★0 | peer `@earendil-works/pi-coding-agent: "*"` | 「evidence-gated completion」、`/goal audit on`、予算（追加分だけ数える）、5 回同一のツール呼び出しで停止。作者の測定: 「pi reported 238,196 tokens where the turns had actually added 16,168」。継続は「settled idle boundary」。1.2.0 の `messageType` に追従済みと README に明記 |
| `pi-goal-x`（tmonk） | 0.32.3 | push 2026-10-02、★105、Issue 7 | peer `>=0.83.0<2.0.0` | 「independent」な検査役を持つと説明（README の一部のみ読んだ） |
| `@narumitw/pi-goal` | 0.54.13 | 2026-10-18 push、リポジトリ ★717（多拡張の mono repo） | peer `*` | 説明: 「autonomous single-objective /goal completion」 |
| `@zhushanwen/pi-goal` | 0.15.0 | 2026-10-18 | peer `^1.0.0` | 「evidence-based completion」 |
| `@arhen/pi-core-goal`、`@lukisxyz/pi-core-goal` | 0.0.4、1.0.1 | 2026-10 | peer `*` | 説明に「automatic continuation after agent_settled」 |

どれも星が少なく（pi-goal の 234 が目安）、複数が 10 月に動いている。Michaelliv/pi-goal 以外は、新しい pi の版に合わせた記述がある。ただし、どれも README を読んだのは上の 3 本だけで、シェルコマンドの終了コードで完了を検査する方式（gate.ts の `/gate`）を持つかは未確認。pi-goal と同系の「自己申告＋監査の文言」が主流に見える。

## 6. gate.ts と pi-goal を同時に入れたら衝突するか

衝突する。ただしエラーにはならず、どちらも素の `/goal` で呼べなくなる。

`runner.js`（1.3.0 の 556〜584 行）の `resolveRegisteredCommands()` は、同じ名前を登録した拡張が複数あるとき、`${command.name}:${occurrence}` を呼び出し名にする（`goal:1`、`goal:2`）。上書きも拒否もしない。0.85.1 の同関数（446〜460 行）も同じ。読み込み順で番号が決まるので、どちらが `goal:1` かは拡張の読み込み順に依存する。`registerCommand` 自体は名前の重複を検査しない（`loader.js` 242〜255 行は空名とハンドラの有無だけ）。

さらに、gate.ts の `goal_complete` と pi-goal の `update_goal`・`get_goal`・`create_goal` は別のツールで、状態も別（gate.ts はモジュール変数、pi-goal はセッションの custom エントリ）なので、二つの「目標」が独立に走る。`before_agent_start` の注入と pi-goal の継続メッセージの二重化も起こる（コードからの推論 [unverified]）。決定ノード 2026-10-19-unattended-runs-native-goal-and-loop.md の「どちらかの名前を変える」は、この解決の仕組みと合う。

ショートカット `registerShortcut` の衝突だけは診断を出して後勝ちにする（`runner.js` 472 行）が、コマンドには無い。

## まとめの表

| 出典 | タスクの種類 | 結果 | 費用の数字 | 失敗の型 |
|---|---|---|---|---|
| pi 1.3.0 の docs と CHANGELOG | 全般 | goal・継続の組み込み無し。`agent_before_settle`（0.87.0）が継続の足場 | 数字無し | 無条件の継続はループしうると docs が警告 |
| pi の型と `exec.js`（0.85.1、1.3.0） | 拡張 API | `exec` の署名と結果の形は gate.ts と合う | 数字無し | 信号で終了すると `code: 0, killed: true` |
| marks-pi-harness | コーディング（ローカルモデル） | gate.ts の元。更新無し（2026-08-10 以降）、MIT | 数字無し | 起源にも `killed` を見ない欠陥 |
| Michaelliv/pi-goal 0.1.7 | コーディング | `agent_end` で継続、トークン予算あり、完了は自己申告。★234、4 か月更新無し | 利用者の報告で「over a billion tokens」 | 無限ループ（#6）、Esc でコンテキスト超過（#7）、旧スコープの import（#5） |
| pi-codex-goal 0.6.1 | コーディング | pi 1.0.0 以降、★195、今日更新 | 既定の予算下限 500,000 | print モードは継続が終わる前に終わりうる |
| @pify/goal 0.10.0 | コーディング | 監査と予算の測定あり、★0 | 238,196 対 16,168（数え方の差 14.7 倍、作者の測定） | 星が無く第三者の実績が無い |

## 結論

### gate.ts は読み込めて動くが、5 分を超えた検査が成功になる欠陥がある

gate.ts は 0.85.1 でも 1.3.0 でも、`exec` の署名・結果の形・`registerCommand`・`registerTool`・`setStatus`・`before_agent_start` のどれも合っている。「全 gate が失敗する」ことは無い。ただし、`GATE_TIMEOUT_MS` を超えた検査は信号で殺され、`exec` が `code: 0` を返すので、gate は通ったことになる。検証の門が、最も遅い検査で開く。`r.killed` を失敗に数える修正が要る（起源にも同じ欠陥）。

### 無人の継続は gate.ts にも pi 本体にも無い

gate.ts は目標を毎回のプロンプトに差し込むだけで、ターンの後に次のターンを起こさない。pi 本体にも goal 機能は無い。本体が与えるのは、0.87.0 で入った `agent_before_settle`（同じ実行の中で `continue: true` を返して 1 回継続する）だけで、docs 自身が「無条件の継続はループしうる」と警告している。今の手元の主力 pi は 0.85.1 で、この足場が無い。Nix 側の 0.87.1 には有る。

### pi-goal は継続を持つが、検証と保守で gate.ts の代わりにならない

pi-goal の完了は自己申告で、gate.ts の「検査コマンドが通るまで閉じない」に当たるものが無い。4 か月更新が無く、無限ループの Issue（#6）と 10 億トークン超の費用の報告が未解決のまま。画面なしの実行は README に記述が無く、同系の pi-codex-goal は print モードが途中で終わりうると明記している。同時に入れると `/goal` は `goal:1` と `goal:2` に分かれ、素の名前では呼べなくなる。

### 勧め

1. gate.ts を残して直す（根拠: 型は合う、検証の門は他の拡張に無い、欠陥は 1 行で直る）。`r.killed` を失敗として扱う。`pi.exec` に `signal` を渡して Esc で止まるようにするのも同じ変更で足せる（`ExecOptions.signal`）。
2. 無人の継続が要るなら、pi-goal を入れず、gate.ts に `agent_before_settle` の継続を足す案を先に検討する（0.87.0 以降が前提）。目標が有効で gate が未通過のときだけ `continue: true` を返し、継続の回数とトークンに上限を付ける。根拠は docs の警告、pify の「5 回同一呼び出しで停止」の型、pi-goal #6 の費用事故。公開された実例は見つけていない。先に pi の版を 0.87.1 以上に揃える（Nix の版が PATH で負けている）。
3. 既製品を入れるなら pi-goal ではなく、1.x に対応を明記し直近に更新のある拡張（`pi-codex-goal` か `@pify/goal`）を、実機で試してから選ぶ。どちらも gate.ts の検査コマンドは持たない見込みなので、入れるなら gate.ts の `/goal` を別名にする。
4. 無人実行は、継続の拡張に頼らず `pi -p` の一回ごとの実行と、外側の機械が確かめる成功条件の形が、現状では最も根拠がある。ただしこれは自前の実行系を作らないという既存の決定とぶつかるので、持ち主の判断が要る。

## 前例が見つからなかったもの

- pi 本体の goal、自律継続、無人モードの機能（docs、CHANGELOG、パッケージ内を検索して無し）。
- シェルコマンドの終了コードで完了を検査する pi の goal 拡張（読んだ 3 本には無い。残りは未確認）。
- `agent_before_settle` で goal を継続した公開の実例。
- pi-goal を print / RPC で最後まで回した報告。
- gate.ts と pi-goal を同時に使った報告。
- 起源 marks-pi-harness の gate.ts の使用報告や Issue（Issue は 1 件で、gate とは無関係）。

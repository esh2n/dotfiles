# omp の eval は `prompt` のまま。yolo の下で人が見る唯一のツールとして残す

Status: accepted — 持ち主の裁定（2026-09-27、「維持でいいよ」）。選択肢は「(a) `prompt` 維持 / (b) `allow` / (c) `deny`」の三つで、(a) を採った。

rule: Keep `tools.approval.eval: prompt` in omp's config alongside `tools.approvalMode: yolo`. It is the only layer that sees code the guard's static extraction cannot resolve, and it is omp's own documented lever for the gap `bash.patterns` cannot close — never remove it to reduce prompts, never raise it to `deny`, and never describe it as a boundary. Nothing in omp is a boundary: for untrusted input the boundary is running omp inside the sandbox (yomp/sbx).

## Problem

omp は `approvalMode: yolo`（読み・書き・実行すべて承認なし）で走り、同時に**常設の Python / JavaScript カーネル** `eval` を持つ。このツールはホスト上の subprocess としてあなたの権限で動き、shell を起動でき、`bash.patterns` の対象外である（omp 自身の文書が *"the `eval` tool also declares the `exec` tier and can spawn a shell via subprocess, so a `bash.patterns` `deny` rule does not apply to the same command run through `eval`"* と明記し、*"Must additionally set `tools.approval.eval: prompt`/`deny` to close that gap"* と指示する）。

一方で、`yolo` の下でプロンプトを出す手段は限られる。「yolo だから `eval: prompt` は無意味」という理解は誤りで（このセッションで一度そう主張して訂正した）、どこまでが本当かをコードで確定させる必要があった。

## Decision

- `home/shared/harness/omp/config.yml.template` の `tools: {approvalMode: yolo, approval: {eval: prompt}}` を**現状のまま維持**する。設定変更は無く、この決定は「変えない」ことの記録。
- `allow` にも `deny` にもしない。
- これは境界ではない。境界が必要な作業（信頼できないリポジトリ、プロンプトインジェクションの可能性がある入力）は sandbox（yomp/sbx）で走らせる、という別の決定に属する。

根拠（コードで確認した意味論）:

- `packages/coding-agent/src/tools/approval.ts:241-259` の `yolo` 分岐は、ツール自身が policy を宣言していない場合 `policy: combinedUserPolicy ?? "allow"` を返す。同ファイル `:186-187` の doc コメントも *"In yolo mode, override-based tool prompts are ignored; user `tools.approval` settings remain authoritative."*
- `eval` ツールの宣言は `readonly approval = "exec"`（`tools/eval.ts:297`）＝ **tier だけで policy を持たない**。したがって yolo 下でも `tools.approval.eval: prompt` がそのまま採用され、`source: "user"` の `prompt` になる。
- ベンダー自身のテストがこの意味論を固定している（`test/tools/approval.test.ts:82-83`: ユーザー設定なし + `write` → `prompt`、ユーザー設定なし + `yolo` → `allow`）。すなわち **yolo 下でプロンプトが出る唯一の経路が `tools.approval.<tool>`**。
- 承認ダイアログには `Language:` と `Code:` が出る（`tools/eval.ts:298-304`）＝ 承認時にセル本文が人間に見える。

## Alternatives considered

- **`allow`（eval を無人で通す）**: 残る層は jig guard だけになる。guard は eval を `shell.exec` に翻訳し、セル本文とクォート文字列（同一引数リストの連続リテラルは連結して `["rm","-rf","/tmp/x"]` を `rm -rf /tmp/x` に戻す。`harness/jig/adapters/omp/src/map.ts:265-309`）を規則に当てるが、**静的読解**である。`"".join(parts)`、変数から組み立てた文字列、読んだファイルの `exec`、import したモジュールの中身はコマンドとして現れない。規則は `forbid`/`ask` が suspects に当たり（`harness/jig/src/domain/policy/evaluate.ts:92-101`）、モードは denylist なので**一致しなければ allow**。計算で作られたコードをカバーする層が消えるため却下。
- **`deny`（eval を使わせない）**: 18 製品中 12 はインタプリタを積んでおらず、業界的には最も普通の選択（`rules/research/2026-09-27-code-execution-gating-across-agents.md`）。しかし eval は omp の常設ツール（`loadMode = "essential"`）で、コスト側の根拠が無いまま機能を落とすことになるため却下。プロンプトは eval にしか付かず、常用は `bash`/`read`/`write` なので実費が小さい。
- **`bash.patterns` に eval 用の規則を足す**: 原理的に不可（パターンは `bash` ツールだけを gate する）。jig は `config.yml` を所有しない方針でもあり却下（テンプレートのコメントにあるとおり）。
- **OS sandbox をこの決定に含める**: 却下ではなく分離。「プロンプトを残す」と「境界を作る」は別の決定で、後者は sandbox の運用（yomp/sbx）として扱う。この記録は前者だけを決める。

## Consequences

- eval のセルごとに確認が 1 回入る。対話 UI が無い実行（ヘッドレス、サブエージェント）では**プロンプトは通らず eval は失敗側に倒れる**（omp 自身の eval prelude 実装が `hasUI === false` で例外を投げる: `eval/preludes.ts:86-93`）。安全側だが、そこで eval は使えない。
- プロンプトは速度制限であって境界ではない。ベンダー実測で承認プロンプトの 93〜97% は承認され、50 プロンプト以降の拒否率は 5% まで落ちる。頻度が上がれば形骸化する。
- **未確認**: 実地でこのダイアログが本当に出ているか。2026-09-27 のログには承認イベントが 1 件も無いが、あのログは承認を記録しないので証拠にならない（ヒットした 18 件はサブエージェント名 "OmpApproval" がタイトル生成行に混ざったもの）。確認手段は「eval 実行時に `Language:` / `Code:` の選択が出るか」を見ること。出ないなら設定が届いていないのでこの決定を蒸し返す。
- この決定は `config.yml.template` のコメント（"never something jig replaces, and never a substitute for it"）と同じ内容を、却下案とコード出典つきで固定する。テンプレートのコメントだけでは「なぜ `allow` にしないのか」が読み取れない。

## Sources

- omp の文書: `docs/approval-mode.md`（`bash.patterns` が eval に届かないこと、`eval: prompt`/`deny` の指示、パターン方針は「process or filesystem containment」ではないこと）、`docs/python-repl.md`。
- omp 18.2.11 のソース（`/nix/store/…-omp-18.2.11/lib/omp/packages/coding-agent/`）: `src/tools/approval.ts:173-259`、`src/tools/eval.ts:295-304`、`test/tools/approval.test.ts:82-83`、`src/eval/preludes.ts:86-93`。
- jig 側: `harness/jig/adapters/omp/README.md:28,38-43,60-61`、`adapters/omp/src/map.ts:265-309`、`src/domain/policy/evaluate.ts:92-101`。
- 調査記録: `rules/research/2026-09-27-code-execution-gating-across-agents.md`（18 製品の型。境界が全く無いのは omp と pi の 2 つだけ）、`rules/research/2026-09-27-practitioner-agent-approval-practice.md`（著名人 12 名に「毎回承認」する運用は一人もいない。承認疲れの実測）。

# yoki-graph — sandbox と gate

> [SKILL.md](../SKILL.md) の詳細編。

## sandbox(agent() ごとの書き込み権限)

**デフォルトは `read-only`**(codex 自身のデフォルトと同じ)。
書き込む呼び出しだけがスクリプト側で明示的に要求する:

```js
await agent(prompt, { label: 'impl:t1', sandbox: 'workspace-write' })
```

- 値は `read-only` / `workspace-write` / `danger-full-access`。未知の値は
  黙って広げずエラーになる。
- `isolation: 'worktree'` は書き込み権限を**含まない** — scratch worktree で
  編集する呼び出しは `sandbox` も明示する(go-optimize.js の Propose 参照)。
- 実際に `workspace-write` を要求しているのは、編集・コミット・ビルド/テスト
  実行・レポート書き出しの段だけ。レビュー/調査/検証の段は read-only のまま
  — これらのプロンプトは diff hunk や取得した外部テキストで組み立てられる。
- どのバックエンドも黙って無視しない: codex は `-s <mode>`(ネイティブ)、
  omp は `--tools read,grep,glob,web_search` の許可リストで read-only を
  表現する。`workspace-write` / `danger-full-access` は omp では追加フラグ
  無し(それ自身の既定より広い権限が無いため)。

## gate(agent() ごとのコマンド検証)

```js
await agent(prompt, { label: 'gate', gate: 'npm test' })
```

`agent()` が返った**あと**にシェルコマンドを1回走らせ、その終了コードで
結果の採否を決める。exit 0 ならそのまま通し、非0(またはタイムアウトで
kill)なら**バックエンド失敗と同じ扱い** — journal に `status: "error"` と
`gate: {command, exitCode, ms, killed}` が残り、`agent-end` は error、
`agent()` は `null` を返す。

- **走る場所**は「そのエージェントが実際に書いたツリー」:
  `isolation: 'worktree'` ならその worktree、そうでなければランの `cwd`。
  worktree は呼び出しの `finally` で片付くので、ここが
  「`npm test` が“今書かれたコード”を意味する」最後の瞬間になる。
- **走る順番**は backend 呼び出し → schema 検証 → gate。schema 違反は
  先に throw する(形が違うなら検証すべき成果物がまだ無い)。
- **リトライしない**。gate は済んだ仕事に対する判定で、同じツリーに同じ
  コマンドを当て直しても答えは変わらない。タイムアウト時のメッセージは
  "timed out" を含むため、明示的に非一時障害として印を付けてある。
- **key に入る**ので、gate を足した/変えた呼び出しは `--resume` で再生
  されず走り直る(検証されていない結果・別の基準を通った結果は再利用
  しない)。失敗した gate も `status: "error"` なので再開時に再実行される。
- タイムアウトは `gateTimeoutMs` > `--gate-timeout <ms>` > 既定10分。
  エージェント本体の `timeoutMs` とは別枠。
- `npm test` のような素のコマンドは argv に分割して直接 spawn する。
  `&&` / パイプ / リダイレクト / glob / `$VAR` を含むときだけ `sh -c`。
- 進捗行: `⛨ gate gate: npm test → pass (12s)` / `→ fail (exit 1)` /
  `→ fail (timed out)`。`--json` では `agent-gate` イベント。

> **信頼境界**: gate 文字列は**ワークフロー側が書いたもの**(ワークフロー
> スクリプト、または起動時に人が渡した `args`)に限る。モデルの出力・diff
> hunk・読み込んだファイル・取得したページから組み立ててはならない。
> オペレータの権限でそのまま実行される。

モデル判定を置き換えるものではなく**併用**する: 「どの失敗が効くか」
「テストが無い」といった判断はモデル、ビルド/lint/テストの合否は gate。

| workflow | 付く呼び出し | コマンド |
| --- | --- | --- |
| `implement.js` | Gate 段(`gate`) | `args.gateCommand`、既定オフ |
| `preflight.js` | Gate 段(`lint-and-mark`) | `args.gateCommand`、既定オフ |
| `go-optimize.js` | Propose(候補 worktree ごと) | `args.gateCommand`、既定 `go build ./... && go vet ./...` |

implement / preflight はどのプロジェクトでも走るので既定のコマンドを
決め打ちできない。go-optimize は Go パッケージ専用なので既定を持つ
(`gateCommand: false` で無効化)。


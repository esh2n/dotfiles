# yoki-graph — backend の混在とプロバイダ・レーン

> [SKILL.md](../SKILL.md) の詳細編。プロバイダ・レーンが内部で叩く単発 CLI そのものの仕様(フラグ・exit code・`--allow-mock`)は `yoki-agent` スキル。

## 1つのランで backend を混ぜる(呼び出しごとの backend)

`--backend` はランの既定値。呼び出し1つだけ別の backend に振るには
`agent(prompt, { backend: 'omp' })`。1つのランで codex と omp のレーンを
混ぜられる。

| 呼び出しごと | ラン全体で共有 |
| --- | --- |
| backend モジュール(argv・実行・usage の読み方・schema ネイティブ対応) | 同時実行セマフォは**1つ**。混ぜても並列度は倍にならない |
| モデル解決(その backend の tier マップで引く。`sonnet` の実 ID は codex と omp で違う) | journal / ロック / `--resume` の index 列 |
| sandbox の既定値と表現方法 | 実行キャップ(agent 呼び出し数・トークン・wall) |

存在しない backend 名は**致命的エラー**でランごと止まる(`null` に
落とさない)。`{backend: 'codexx'}` が黙って `null` になると「その
プロバイダは何も見つけなかった」と区別がつかず、しかも全レーンで同時に
そうなるため。

## Claude Code から Codex/omp レーンを混ぜる

**これは Claude Code 内で使う機能**で、yoki-graph の CLI 機能ではない。
`review` / `research` / `design-review` に `providers` 引数が増えた:

```js
Workflow({ name: 'review', args: { providers: ['claude', 'codex'] } })
Workflow({ name: 'research', args: {
  question: '…',
  providers: ['claude', { provider: 'codex', model: 'gpt-5.6-sol' }],
} })
```

- 既定は `["claude"]`。**指定しなければ挙動は従来と完全に同じ** —
  ラベルも prompt も agent() の呼び出し列(= journal と `--resume` の
  prefix)も変わらない。
- 指定するとレーンが「次元 × プロバイダ」に増える。review なら
  `review:correctness` に加えて `review:correctness@codex/sonnet` が走る
  — ただし `security` 次元だけは例外(下の「security 次元は既定で claude
  だけ」を参照)。
- **知らないプロバイダ名・変なモデル id はランを止める(fatal)**。以前は
  黙って捨てていたので、`["claude","codeex"]` は claude だけのランになり、
  それは既定のランと見分けがつかなかった(ログ行すら出ない)。「2社で見た」
  と思っている読み手に1社の結果を渡すのが、この機能がいちばん避けたい
  失敗。モデル id は `^[A-Za-z0-9._:/-]{1,64}$` に限る — コマンドラインに
  そのまま乗る値なので、空白や `;` が入ると1つのコマンドが2つになる。
- **なぜ proxy が要るか**: Claude Code は codex/omp を自分で起動できず、
  yoki-graph には(意図的に)claude backend が無い。そこで橋渡しとして
  安い Claude subagent(haiku・effort low・**sandbox は read-only**)を
  1つ立て、それが `yoki-agent --backend <p> --model <m> --schema-base64
  <b64> --sandbox read-only --prompt-base64 <b64> --json` を
  **1回だけ、それ以外は何もせず**実行し、返ってきた JSON を**一切言い換えず
  そのまま**返す。非ゼロ終了なら `{ok:false, error, exitCode, stderrTail}`。
  proxy は運搬役であって評価者ではない — 別プロバイダの意見を得るのが
  目的なので、要約・再スコアリング・並べ替え・自前回答はすべて禁止。
- **payload は base64 の引数で渡す**。以前は proxy の指示文の中に固定の
  `<<<YOKI_PROMPT` 区切りで貼り付けていたので、payload の中に
  `YOKI_PROMPT` の行と新しい手順を書けば、ランで最弱のモデルに対する
  トップレベルの指示として読めてしまった。いまは指示文に入るのは
  `[A-Za-z0-9+/=]` だけで、ブロックは**呼び出しごとに変わる fence**で
  囲み、payload がその fence を含んでいたらレーンの生成自体を拒否する。
  一時ファイルを作らないので proxy に書き込み権限も要らない。
- **失敗したレーンは落ちる。ただし黙っては落ちない**: `log()` に
  `review:tests@codex/sonnet: dropped — codex exec exited 1 — exit 2` の
  ような1行が出る。捏造した所見で埋めることはしない。fixture で答えた
  レーン(`--allow-mock`)も `MOCK RESULT` として1行出る。
- **Verify とマージ**: 検証(adversarial verify)は必ず Claude 側で回す —
  プロバイダに自分の審判をさせない。確定した所見は
  **file + line + title**(research は claim + source、design-review は
  claim)で重複排除し、**和集合**を残す: 両者が挙げた所見は
  `providers: ["claude","codex"]` を持つ1件にまとめ、片方しか挙げなかった
  所見はそのまま残る。所見には `provider` / `model` が付き、返り値には
  プロバイダ別にまとめた `by_provider` が入る。
- **agentType はレーンに転送しない**: `agent(prompt, {backend: 'codex',
  agentType: 'security-reviewer'})` のように**直接** backend を渡す呼び出しなら
  `backends/common.js` の `resolveAgentPreamble` が backend を問わず同じ
  `<name>.md` を引く。しかし `review.js` 自身の provider レーン(この節の
  proxy 機構)はその経路を通らない — `code-reviewer` / `security-reviewer`
  のような次元の agentType は **claude 側のレーンにしか渡さない**。非
  claude 側は persona をプロンプト本文だけで組み立てる(次元名は元々
  reviewerPrompt に入っている)。理由は、別プロバイダに振る目的が
  「Claude 用にこのリポジトリが用意したチェックリストの模倣」ではなく
  **そのプロバイダ自身の判断**を得ることだから — 定義ファイルを転送すれば
  それが失われる。
- **security 次元は既定で claude だけ**: `review` の `providers` に非
  claude を入れても、`security` レーンは既定では**そのプロバイダに回らない**
  ——`externalSecurityLane: true` を明示したときだけ回る。他の次元は
  `providers` が増えれば素直に倍になるのに対し、security だけ別扱いなのは、
  そのレーンの payload が「差分」に加えて「そのプロバイダ自身が見つけた、
  まだ直っていない具体的な脆弱性のリスト」を含むから — 未修正コードの
  具体的な exploit map を、パッチが出る前に社外(そのプロバイダ自身の
  インフラ)で生成・送信させることになる。この判断を踏まえた上でだけ
  opt-in する。
  ```js
  Workflow({ name: 'review', args: {
    providers: ['claude', 'codex'],
    externalSecurityLane: true, // opt-in: security も codex に回す
  } })
  ```
  フラグなしのランは、ランの開始時点で非 claude プロバイダを含むかどうかに
  関わらず `log()` に `diff content will be sent to codex` のような1行を出す
  — 差分そのものがどのプロバイダに流れるかは security 次元の除外と無関係に
  常に見えるようにする。
- **ヘルパの正本は `core/workflows/lib/lanes.js`**。Workflow スクリプトは
  モジュールを持たない(`require`/`import`/fs いずれも不可 — 両ランタイムとも
  固定のグローバルだけを注入した素の async 関数に body をコンパイルする)ため、
  3本のスクリプトに**同一の本文をインライン複製**している。直すときは
  lanes.js を先に直してから3本に貼り直す(`lanes.test.js` が
  4つのコピーのバイト一致を検査していて、ズレると落ちる)。


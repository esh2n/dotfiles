# PROTOCOL-C — オンラインで走らせる腕 C（一覧は見せたまま、ルータを上乗せ）

[PROTOCOL.md](./PROTOCOL.md) の**追補**であって、置き換えではない。PROTOCOL.md と
[FROZEN.md](./FROZEN.md) は凍結物であり、この文書は一文字も触れない。腕の定義（§0・§2）、
質問文（§3）、閾値の考え方（§4）、「データが答えられないこと」（§8）、判定不能条項（§9）は
すべて PROTOCOL.md のものをそのまま引き継ぐ。ここが足すのは一つだけ——**腕 C を実機で
走らせるときの窓・指標・昇格規則**である。

オフラインの結果は [RESULTS-OFFLINE.md](./RESULTS-OFFLINE.md)。あちらの結論は
「事前宣言の規則では **UNDETERMINED**、B' は昇格しない」であり、この追補はその結論を
覆すものではない。B' ではなく C を先に実機に出すのは、C が**失敗しても何も失われない**
（一覧は見えたままなので、ルータが黙ってもその turn は今日と同じ）唯一の腕だからである。

```
addendum_version: 1.0
extends:           PROTOCOL.md（protocol_version 0.1-draft、FROZEN.md 2026-09-23 で凍結）
window_start_commit: フラグを shell 設定に入れたコミット（2026-09-23、`feat(jig): arm C flag in shell config`。fish `conf.d/init.fish` と zsh `integrations.zsh` で `JIG_SKILL_ROUTER_QUESTION=choice`）
window_start_date:   2026-09-24 00:00 JST（倒したのは 09-23 昼、開始日は翌日の 0 時から数えて 14 日）
window:              14 日（開始日を含む 14 日間）
```

窓の起点は**オーナーがフラグを倒した日**であって、この文書を書いた日ではない。倒した時点の
コミットハッシュを上の欄に記入してから測定を始める。記入前のログは窓に入れない。

---

## 1. 腕 C の設定（PROTOCOL.md §2 の C セル + 質問形式）

```
JIG_SKILL_ROUTER=1
JIG_SKILL_ROUTER_QUESTION=choice          # 追加。既定は bool のままで、これを倒すのがフラグ
JIG_SKILL_ROUTER_THRESHOLD=0.7
JIG_ROUTER_FALLBACK=0
frontmatter:  disable-model-invocation は付けない（一覧は見えたまま）
settings.json: skillOverrides キーなし
```

- **一覧は見せたまま**。C でフォールバックを入れると、見えている一覧の二枚目を同じ turn に
  差し込むことになる（PROTOCOL.md §0）。だから `JIG_ROUTER_FALLBACK=0` は C の定義の一部で
  あって、設定の好みではない。
- **質問は `choice-en`**。PROTOCOL.md §3b の EN セルの文言をそのまま使う。実装は
  `jig/src/app/routing/select-skills.ts` の `SKILL_CHOICE_QUESTION` にリテラルで置いてあり、
  同じ文字列が凍結物と一致していることがこの腕の前提である。英語なのは
  [`rules/decisions/2026-09-23-model-facing-english.md`](../../decisions/2026-09-23-model-facing-english.md)
  （モデルが読む物は英語、jev の質問の枠を含む）による。
- **閾値 0.7**。PROTOCOL.md §4 の掃引値の真ん中。30 日のルータログの最良候補確信度の中央値が
  0.71 で、本番の 0.8 は中央値の上にある——0.8 のままでは C は大半の turn で何も差し込まず、
  「ルータを上乗せした腕」を測ったことにならない。
- **上限 3 件**は変えない。確率の高い順に並べ、0.7 を超えたものだけを、最大 3 件。

### 1.1 この腕を可能にした配線の変更（2026-09-23）

RESULTS-OFFLINE.md §1.3 の 2 点目が見つけた穴——`/decide` の `choice` 応答が
`{op, value, confidence}` しか運ばず、選択肢ごとの `probabilities` を捨てていたため、
choice 系の top-3 がサービス越しには**取得不能**だった——を塞いだ。

- 応答に省略可能な `probabilities` を足した（両方向に省略可能: 古いサービスは送らず、
  古いクライアントは無視する）。
- ルータに `JIG_SKILL_ROUTER_QUESTION=choice|bool` を足した。`choice` は 54 本の bool の
  代わりに、全候補 + 明示的な `none` を並べた **1 問の choice** を投げ、返ってきた確率で
  候補を並べ、同じ閾値と同じ上限 3 件を適用する。既定は `bool` のまま。

**確率が上乗せの根拠になった**ことは記録しておく価値がある。1 問の choice は答えを 1 つしか
返さないので、分布が無ければ top-3 は原理的に作れない。分布を運ばないサービス（この変更より
古いもの）に当たった場合、実装は top-1 に素直に縮退する——top-3 を推定で埋めることはしない。

---

## 2. 事前宣言の指標

宣言は測定開始前に確定しており、ここに無いものは結果として報告しない。出どころは 2 つだけ:
**ルータログ** `~/.local/state/jig/skill-router.jsonl` と **`jig report skills`**。

| 指標 | 定義 | 出どころ | 付ける区間 |
|---|---|---|---|
| **follow rate** | 何かを差し込んだ turn のうち、モデルがその skill を `Skill` か `Read` で開いた割合 | `jig report skills` | Wilson 95% |
| **distinct skills followed** | 窓のなかで実際に「開かれた」skill の異なり数 | `jig report skills` | 区間なし（個数） |
| **fallback rate** | 差し込みがフォールバック目録だった turn の割合。**C では 0 のはず** | ルータログ（`fallback` フィールド） | Wilson 95% |
| **latency P50 / P95** | `latency_ms`（判定呼び出しの前後で測った壁時計） | ルータログ | 区間なし（分位点） |
| **usage per decision** | 判定 1 件あたりの入出力トークン | ルータログ（`usage`） | 区間なし（平均） |

**human prompt だけを数える**。`skipped` の付いた行（compaction pass、task notification、
サブエージェント発の prompt など `domain/skills/prompt-origin.ts` が弾いたもの）は、そもそも
判定を投げていない——**構成上除外されている**のであって、後から外すのではない。分母を人の
依頼だけにするための操作は不要で、ログがすでにそうなっている。

**fallback rate が 0 でなかったら、その時点で腕 C ではない**。C は `JIG_ROUTER_FALLBACK=0`
で定義されており、`fallback` フィールドの付いた行が 1 行でもあれば設定が C ではなかったと
いうことなので、窓を破棄して設定を直してから測り直す。指標としてではなく、設定の検算として
そこに置いてある。

**usage はフック経路の行には載らない**。Claude Code のフックは `/decide` 越しに判定するが、
`/decide` の応答はトークン数を運ばない（`domain/decision/remote.ts`）。載るのは `/skill` を
叩く経路（pi・DSH）の行だけである。Claude Code だけで窓を回した場合、この指標は
「測れなかった」であって 0 ではない——報告では母数を明示する。

---

## 3. 昇格規則（オーナーの言葉どおり、先に決めてある）

> **follow rate が 30% 以上、かつ、実際に開かれた skill が 3 種類以上**なら、ルータを
> **形 C のまま残す**。
>
> **そうでなければ、ルータを外す**。腕 A に戻し、言語 skill には `paths:` ゲートを付ける
> （`paths:` を持たないハーネスでは、言語ごとの配布で同じ効果を作る）。
>
> **B' を試すのは C が通ったときだけ。**

条件は連言である。follow rate が 45% でも開かれたのが 2 種類なら通らない——1 本の skill が
繰り返し当たっているだけの状態は、54 本の目録を判定させる理由にならないからである。

「ルータを外す」は文字どおり外すことであって、閾値を下げて測り直すことではない。閾値を
動かすのは窓を新しくすることであり、同じ窓のデータで 0.6 と 0.7 を見比べて良かった方を採る
のは、結果を見てから腕を選ぶことになる（PROTOCOL.md §9 が禁じている振る舞い）。

A に戻す枝は PROTOCOL.md §0 のオーナー条件をそのまま含む: 言語/フレームワーク skill は
すべて `paths:` の glob を持ち、Claude Code は該当ファイルが場にあるときだけ自動で読む。
`paths:` 相当のゲートを持たないハーネス（pi・Codex）では、`~/.agents/skills` にそのマシンで
有効な言語パックの分だけを配る。これは A 枝の本体であって、後回しの追加作業ではない。

---

## 4. 計算のしかた

### 4.1 `jig report skills`（follow rate と異なり数）

窓の日数をそのまま `--days` に渡す。開き方は既定（`Read` と `Skill` の両方を数える）で、
`--opened-via read` は 2026-09-22 以前の数字を再現するための旧設定なので**使わない**。

```sh
# 人が読む形
jig report skills --days 14

# 機械が読む形（下の集計スクリプトに食わせるのはこちら）
jig report skills --days 14 --json > /tmp/arm-c-report.json
```

`--days` は「今日から遡って」なので、窓が閉じた**その日のうちに**実行する。翌日以降に
実行するなら日数を足して、窓の外の行が入っていないことを `turns` の期間表示
（`spanning … → …`）で確かめる。

読むフィールド:

- `totals.followed` / `totals.partial` / `totals.ignored` — 差し込みがあった turn の内訳。
  **follow rate = followed / (followed + partial + ignored)**。`partial`（複数差し込んで
  一部だけ開いた）は分子に入れない。
- `skills[]` の `followed > 0` の行数 — **distinct skills followed**。
- `totals.silent` / `totals.unrouted` は差し込みの無かった turn なので、どちらの分母にも
  入らない。

### 4.2 `tools/arm-c-report.mjs`（ルータログ側と、上の突き合わせ）

```sh
node tools/arm-c-report.mjs --from 2026-09-24            # 窓の開始日。既定 14 日
node tools/arm-c-report.mjs --from 2026-09-24 --days 14 \
     --report /tmp/arm-c-report.json                      # follow rate も一緒に出す
```

ルータログ（既定 `~/.local/state/jig/skill-router.jsonl`、`--log` で差し替え可）を窓で切り、
fallback rate・latency P50/P95・usage per decision・差し込んだ skill の異なり数を出す。
`--report` を渡すと `jig report skills --json` の出力から follow rate と「開かれた」異なり数も
拾い、昇格規則の 2 条件をそのまま判定して印字する。割合には Wilson 95% 区間が付く。

読み取り専用である——ログにもリポジトリにも何も書かない。

---

## 5. この腕について、先に言っておくこと

PROTOCOL.md §8 の 9 項目はすべてそのまま効いている。C に固有のものを 3 つ足す。

1. **C は元の動機を達成しない。** ルータを作った理由は、一覧（このマシンで個人 skill 分
   4,462 トークン/セッション）をモデルの文脈から外すことだった。C は一覧を見せたまま、
   その上に差し込みを重ねる——**文脈は増える方向**であり、減らない。C で測れるのは
   「jev の順位付けは、モデル自身の選択より良い差し込みを作るか」だけで、節約の問いは
   B' が通らない限り答えられないまま残る。この腕を通すことは、節約の問いを諦めることでは
   なく、**節約の前に「順位付けに価値があるか」を先に確かめる**ことである。

2. **jev はモデル自身の選択をあまり再現していない。** RESULTS-OFFLINE.md §3.4: 本番の門
   （τ=0.8）で、モデルが自分から開いた 27 turn のうち jev が同じ skill を選んだのは
   **5 件**（choice-en では 9 件）。n=27 で区間は極端に広く、27 件のうち 8 件はラベル付け
   側が明示的に異議を記録しているので、これは判定ではなく旗である。だが C はまさに
   「モデルが見えている一覧から選ぶ」ところに jev の順位を重ねる腕なので、**一致率が低い
   ことは C の前提が弱いという意味**になる。差し込みがモデルの選択と食い違うたびに、turn は
   どちらかを無視する。

3. **follow rate は「開いた」でしかない。** PROTOCOL.md §8.5 のまま: 開いたことは、読んだ
   ことでも、従ったことでもない。加えて §8.4——`cat`/`sed`/`grep` でのシェル読みは tool call
   ではないので数えられず、follow rate はどの腕でも同じだけ**過小**に出る。30% という
   閾値はこの過小を織り込んだ値としてオーナーが置いたものであり、「正しい追従率」ではない。

4. **一覧は凍結時の 54 本ではない。** 開始までに生成器 M2 が入り、pack の on/off が無くなって
   `~/.claude/skills` は 100 本（commands 由来の 11 本、obra の 2 本を含む）になり、日本語だった
   description は英語に書き換わった。`catalog-snapshot.json` は凍結記録として残すが、C の
   follow rate と distinct-skill 数は**開始時点の実カタログ**（`jig report skills` が読む
   `~/.claude/skills`）で数える。一覧が倍近く増えたぶん、モデル自身の選択（分母側）が
   凍結時と同じ振る舞いをする保証はなく、A との比較は「同じ一覧」ではない——結果の節で
   必ず断る。

---

## 6. この追補が変えていないもの

- PROTOCOL.md・FROZEN.md・`catalog-snapshot.json`・`prompts.jsonl`: 一文字も触っていない。
- ラベル、質問文、閾値の候補、ケースの集合: すべて凍結のまま。C が使う `choice-en` の文言は
  PROTOCOL.md §3b からの**引用**であって、ここで決めたものではない。
- B' の昇格規則（PROTOCOL.md §7）: C の規則はそれと並ぶものではなく、§7 の「otherwise」枝の
  なかで「ルータを形 C だけで残す」と書かれていた選択肢に、実機で判定するための数字を
  与えたものである。

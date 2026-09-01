# yoki-artifact セットアップ手順

Cloudflare 側の初期構築は「人がダッシュボードで一度だけやること」と
「`scripts/setup.mjs` が API でやること」に分かれる。前半を飛ばすと後半は
必ず失敗するので、上から順に読む。Terraform は使わない。

- 手動（この文書の前半）: Zero Trust のオンボーディング、Google と GitHub の
  IdP 登録、R2 の有効化、API トークンの発行
- 自動（`scripts/setup.mjs`）: D1 / R2 の作成、マイグレーション、デプロイ、
  Access アプリケーションとポリシー、サービストークン、設定ファイルの書き込み

---

## 0. 前提

| 必要なもの | 確認方法 |
| --- | --- |
| Cloudflare アカウント（無料プランで足りる） | ダッシュボードにログインできる |
| Node.js 20 以上 | `node --version` |
| pnpm | `pnpm --version` |
| プロジェクトに固定した wrangler | `pnpm add -D wrangler` → `pnpm exec wrangler --version` |

wrangler はグローバルに入れない。S7 の前提どおりプロジェクトに固定し、
呼び出しは常に `pnpm exec wrangler ...` を使う（`setup.mjs` もそう呼ぶ）。

無料枠の上限は次のとおり。設計上ここに収まるが、超えると止まる。

- Workers: 100,000 リクエスト/日、CPU 10ms/リクエスト
- D1: 読み取り 500万行/日、書き込み 10万行/日
- R2: 保存 10GB

---

## 1. Zero Trust のオンボーディング（手動）

1. ダッシュボード → **Zero Trust** を開く。初回はチーム名（team name）を
   決めるよう促される。ここで決めた名前が **チームドメイン** になる。
   例: チーム名 `acme` → `acme.cloudflareaccess.com`
2. プラン選択画面では **Free** を選ぶ。50 ユーザーまで無料。支払い方法の
   登録は求められるが、Free のままなら課金されない。
3. 決まったチームドメインを控える。あとで `ACCESS_TEAM_DOMAIN` に入れる。

チームドメインは Zero Trust → **Settings → Custom Pages**（または
**Settings → General**）の "Team domain" で後からも確認できる。

---

## 2. IdP（Google / GitHub）の登録（手動）

Access のログイン画面に出す ID プロバイダーを 2 つ登録する。どちらも
「先に相手側で OAuth アプリを作り、その Client ID / Secret を Cloudflare に
貼る」という同じ形になる。

Cloudflare 側が要求するリダイレクト URI は **両方とも同じ**:

```
https://<team>.cloudflareaccess.com/cdn-cgi/access/callback
```

`<team>` は 1 で決めたチーム名。この URI は Zero Trust の IdP 追加画面にも
表示されるので、必ず画面に出ている実物をコピーする。

### 2-1. Google

1. [Google Cloud Console](https://console.cloud.google.com/) → プロジェクトを
   選ぶ（なければ作る）
2. **APIs & Services → OAuth consent screen** を設定する。個人利用なら
   User Type は External、公開はしない（テストユーザーに自分を入れる）
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://<team>.cloudflareaccess.com`
   - Authorized redirect URIs: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
4. 発行された **Client ID** と **Client secret** を控える
5. Zero Trust → **Settings → Authentication → Login methods → Add new → Google**
   に貼り、**Test** で緑になることを確認する

### 2-2. GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: `https://<team>.cloudflareaccess.com`
   - Authorization callback URL:
     `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
2. **Client ID** を控え、**Generate a new client secret** で secret を発行して
   控える（secret はこの一度しか表示されない）
3. Zero Trust → **Settings → Authentication → Login methods → Add new → GitHub**
   に貼り、**Test** で緑になることを確認する

> GitHub の IdP はメールアドレスを返す。Access のポリシーはメールで判定する
> ので、GitHub アカウントの primary email が許可リストのアドレスと一致して
> いること。一致しないと「ログインはできるが 403」になる。

---

## 3. R2 の有効化（手動）

1. ダッシュボード → **R2** を開く
2. 初回のみ「支払い方法の登録」を求められる。登録しても Free tier
   （10GB / 月）の範囲では課金されない
3. ここでバケットを作る必要はない。`setup.mjs` が `yoki-artifact` を作る

R2 を有効化しないまま `setup.mjs` を実行すると、バケット作成の API が
403 で落ちる。

---

## 4. API トークンの発行（手動）

ダッシュボード → **My Profile → API Tokens → Create Token**。テンプレート
**"Edit Cloudflare Workers"** を選ぶと Workers Scripts と Workers R2 Storage の
編集権限が入るので、そこに D1 と Access の 2 つを足すのがいちばん速い
（Create Custom Token から手で 5 つ選んでもよい）。必要な権限は次のとおり。

| 種別 | 権限 | 何に使うか |
| --- | --- | --- |
| Account | **Workers Scripts: Edit** | `wrangler deploy` |
| Account | **Workers R2 Storage: Edit** | R2 バケット作成 |
| Account | **D1: Edit**（D1 Write） | D1 データベース作成、`d1 migrations apply --remote` |
| Account | **Access: Apps and Policies: Edit**（Write） | Access アプリケーションとポリシーの作成 |
| Account | **Access: Organizations, Identity Providers, and Groups: Edit**（Write） | Access グループとサービストークンの作成 |

- **Account Resources** は対象のアカウントに限定する
- 有効期限は付けてよい。切れたら再発行して環境変数を差し替えるだけ
- 発行後の値は一度しか表示されない。**1Password に保存する**

作成できたら、下の "Verify" ボタン（またはトークン一覧の Verify）で有効性を
確認しておく。

### `wrangler login` を使う代替

API トークンを作らず、`pnpm exec wrangler login` のブラウザ OAuth で
wrangler に権限を渡すこともできる。ただし:

- `wrangler login` が効くのは wrangler が叩く部分（deploy、D1 マイグレーション）
  だけ。**Access アプリケーション・グループ・サービストークンは
  `setup.mjs` が REST API を直接叩くので、`CLOUDFLARE_API_TOKEN` は
  どちらにせよ必要**
- 両方設定した場合、wrangler は環境変数のトークンを優先する
- 対話ログインは CI や別マシンでは使えない。常用は API トークンにする

つまり `wrangler login` は「手元で試すときに wrangler の認証だけ楽をする」
選択肢であって、`setup.mjs` の前提を置き換えるものではない。

---

## 5. 自動セットアップ（`scripts/setup.mjs`）

### 5-1. 環境変数

4 つすべてが必須。1 つでも欠けると実行前に止まる。

```sh
export CLOUDFLARE_API_TOKEN=...            # 4 で作ったトークン。コミット禁止
export CLOUDFLARE_ACCOUNT_ID=...           # ダッシュボード右下 / Workers 概要
export ACCESS_TEAM_DOMAIN=acme.cloudflareaccess.com
export OWNER_EMAIL=you@example.com         # 唯一の書き込み権限者
```

`ACCESS_TEAM_DOMAIN` は `acme` だけでも、`https://acme.cloudflareaccess.com/`
でも受け付ける（正規化される）。`OWNER_EMAIL` は Worker 側の
`OWNER_EMAIL` var にもそのまま入り、publish / revoke / share を許される
唯一の人間になる。

### 5-2. 閲覧者リスト

`viewers.json` にメールアドレスの JSON 配列を置く（`viewers.example.json`
をコピーする）。このファイルは `.gitignore` 済み。

```json
["teammate@example.com"]
```

- ファイルが無ければ「閲覧者ゼロ」として進む（オーナーだけが見られる）
- `--viewers <path>` で別のファイルを指定できる
- 内容は Access グループ `yoki-artifact-viewers` の include に反映される。
  リストから消したアドレスは次回実行でグループからも消える

日常の共有は `viewers.json` の編集ではなく **`yoki-artifact share`**（5-7）を
使う。ただし `setup.mjs` はグループの include を `viewers.json` で**丸ごと
置き換える**。`share` で足したアドレスを恒久的に残したいなら
`viewers.json` にも書いておくこと。書き忘れると次の `setup.mjs` 実行で
Access グループから消える（D1 側の viewers 行は残るので、
「Worker は許すが Access が弾く」状態になる）。

### 5-3. 実行

```sh
cd domains/dev/config/claude-profiles/core/skills/yoki-artifact/worker
pnpm add -D wrangler          # まだなら
node scripts/setup.mjs --dry-run
node scripts/setup.mjs
```

`--dry-run` は **ネットワークに一切触らない**。「何も存在しない状態」を仮定して
実行予定の API 呼び出し・コマンド・書き込み内容をすべて表示する。ダミーの
トークンでも動くので、レビュー用に使える。

実行順は依存関係で決まっている（順番を入れ替えられない）。

1. D1 データベース作成 → `wrangler.toml` の `database_id` を書き換え
2. R2 バケット作成
3. `pnpm exec wrangler d1 migrations apply yoki-artifact --remote`
4. `pnpm exec wrangler deploy` — **Access アプリケーションは Worker を
   destination に指定するので、先に Worker が存在している必要がある**
5. Access アプリケーション作成（`destinations: [{type:"worker",
   worker_id:"yoki-artifact"}]`）
6. Access グループ `yoki-artifact-viewers` 作成／更新
7. サービストークン `yoki-artifact-cli` 作成
8. Allow ポリシー（`OWNER_EMAIL` + `yoki-artifact-viewers` グループ）と
   Service Auth ポリシー（サービストークン）を作成
9. `wrangler.toml` の `[vars]` に `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` /
   `OWNER_EMAIL` / `SERVICE_TOKEN_NAME` を書き込み
10. `pnpm exec wrangler deploy`（本物の `ACCESS_AUD` を載せて再デプロイ）
11. `~/.config/yoki-artifact/config.json` を書き込み
    （`accessGroupId` と `serviceTokenClientId` を含む）

### 5-4. 何度実行してもよい

リソースは **ID ではなく名前**で探す。2 回目以降は既存を見つけて作成を飛ばし、
`[skip] ... already exists` と表示する。壊れた途中状態から再実行して続きを
やらせるのが正しい直し方。

`ACCESS_AUD` と `SERVICE_TOKEN_NAME` が既に `wrangler.toml` と一致していれば、
9 と 10 も飛ばす。

### 5-5. サービストークンの secret

サービストークンの secret は **作成直後に一度だけ** stderr に出る。
Cloudflare 側からも二度と読めない。

- その場で **1Password に保存する**
- CLI から使うときは `YOKI_ARTIFACT_CLIENT_SECRET` に入れる
- `~/.config/yoki-artifact/config.json` には **client id しか書かない**。
  secret はどのファイルにも書かれない
- 無くしたらローテーション（下記 5-6）

### 5-6. `SERVICE_TOKEN_NAME` — オーナー権限を持つトークンの固定

**何を固定するか。** Worker はサービストークンの JWT に入る `common_name`
クレーム（Access はここにトークンの **Client ID** を入れる）を
`SERVICE_TOKEN_NAME` var と突き合わせ、**一致したときだけ** そのトークンを
オーナー扱いする。`setup.mjs` が `yoki-artifact-cli` の `client_id` を
`wrangler.toml` の `[vars]` に書き込む。

これが無かった頃は「Access を通ったサービストークンなら何でもオーナー」
だったので、同じ Access アプリに 2 本目のサービストークンを足すだけで、
publish / revoke / share / 全チャンネル閲覧 / コメント既読化まで通ってしまった。
エッジの Service Auth ポリシーは token_id を 1 本に固定しているが、
**そのポリシーを人が編集すれば増やせる**。Worker 側でも固定する。

**未設定のときの挙動（fail-closed）。** `SERVICE_TOKEN_NAME` が空、または
`REPLACE-...` のままなら、**どのサービストークンもオーナーにならない**。
人間のログインは今までどおり動くが、CLI は publish / revoke / share で 403
`not_owner` を返し、CSRF の免除も外れる。

> **既存デプロイを更新するときの注意**: この var を入れずにデプロイすると
> CLI が 403 で止まる。**Worker のデプロイと `setup.mjs` の再実行はセットで
> 行う**（`node scripts/setup.mjs` が var を書いて再デプロイまでやる）。
> 黙って全サービストークンを通し続けるより、止まって直すほうを選んでいる。

**ローテーション手順**（secret を無くした / 漏らしたとき）:

1. Zero Trust → Access → Service Auth で `yoki-artifact-cli` を削除
2. `node scripts/setup.mjs` を再実行
   （新しいトークンを作り、新しい `client_id` を `SERVICE_TOKEN_NAME` に
   書いて再デプロイし、Service Auth ポリシーも張り直す）
3. stderr に一度だけ出る新しい secret を 1Password に保存し、
   `YOKI_ARTIFACT_CLIENT_SECRET` を差し替える

古いトークンは削除された時点でエッジでも Worker でも通らなくなる。

### 5-7. `yoki-artifact share` と Access グループ

閲覧者の許可は **2 つのリストが揃って初めて**成立する。

| リスト | 実体 | 誰が見るか |
| --- | --- | --- |
| D1 の `viewers` 行 | Worker 内の `canRead()` | Worker |
| Access グループ `yoki-artifact-viewers` | アカウント全体の Access グループ | Cloudflare のエッジ |

D1 だけ更新しても意味がない。**Access が Worker に到達する前に弾く**ので、
共有相手はページを開けない。逆に Access グループだけ更新すると、エッジは
通すが Worker が 403 を返す。

そこで `yoki-artifact share` / `unshare` が**唯一の入口**として両方を更新する。

1. D1 を更新（`POST /api/artifacts/:channel/viewers`）
2. Access グループを read-modify-write で更新
   （`GET` → include をマージ → `PUT`。メール以外の include ルールは
   そのまま保持し、`name` / `exclude` / `require` も維持する）

そのために CLI が必要とするもの:

```sh
export CLOUDFLARE_API_TOKEN=...     # 4 で作ったトークン（環境変数のみ）
export CLOUDFLARE_ACCOUNT_ID=...    # 未設定なら config.json の accountId
```

- Access グループの ID は `~/.config/yoki-artifact/config.json` の
  **`accessGroupId`**。これは `setup.mjs` が書く。古い config で欠けている
  場合は `node scripts/setup.mjs` を再実行すれば入る
  （一時的に `YOKI_ARTIFACT_ACCESS_GROUP_ID` で上書きもできる）

**3 つのどれかが欠けている / Cloudflare が拒否したときは、`share` は
exit 2 で止まり、手でやる手順をそのまま印字する。**「D1 は更新済み」である
ことも明示する。黙って 200 を返して「共有できたつもり」にはさせない。
印字される選択肢は 3 つ:

1. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を入れて同じコマンドを
   再実行する（D1 側は冪等なので安全）
2. `worker/viewers.json` を直して `node scripts/setup.mjs`
3. ダッシュボード: Zero Trust → Access → Access Groups →
   `yoki-artifact-viewers` に Emails の include ルールを足す／消す

### 5-8. `ACCESS_AUD` を secret にしたい場合

`setup.mjs` は `ACCESS_AUD` を `wrangler.toml` の `[vars]` に書く。AUD は
公開識別子（署名検証の対象であって、鍵ではない）なので既定はこれでよい。
リポジトリに書きたくない運用なら、`[vars]` の行を
`REPLACE-access-application-aud` に戻したうえで

```sh
pnpm exec wrangler secret put ACCESS_AUD
```

を使う。Worker 側の `readConfig` は var と secret を区別しないので、
どちらでも動く。

### 5-9. コメントの差出人は読む人によって変わる

同じ 1 件のコメントでも、API が返す差出人は**誰が読んでいるか**で違う。

| 読む人 | `author` | `author_display` |
| --- | --- | --- |
| オーナー（`OWNER_EMAIL` / 固定サービストークン = CLI） | 実アドレス | 仮名 |
| 共有相手（viewers に載っている人） | **返らない**（キーごと無い） | 仮名 |

仮名は `viewer-<16進8桁>` で、`sha256(アドレス + チャンネル名)` の先頭 4
バイト。チャンネル名を混ぜてあるので、**同じ人でもチャンネルが違えば別の
仮名**になる。1 つのページで「この仮名は誰か」が割れても、他のページの同じ
人には結び付かない。同じチャンネルの中では安定なので、スレッドをまたいで
「同じ人の発言」であることは分かる。

解決者（`resolved_by` / `resolved_by_display`）も同じ扱い。例外は
エージェントの返信の `agent via <owner>` で、これは個人ではなく役割なので
誰にでもそのまま見える（オーナーのアドレスはもともとこの表示で公開している）。

`viewers` リストそのものが共有相手に返らないのと同じ理由で、
**ページを 1 枚共有されたことは「他に誰が共有されているか」を知る理由に
ならない**。

---

## 6. 初回に必ず確認すること（S7 で UNVERIFIED のまま）

S7 の spike では実機確認できておらず、**初回セットアップで確かめる**と決めた
項目がある。想定どおりでなければ止まるので、黙って進めないこと。

1. **`destinations` の worker 指定が API で通るか**
   通らなければ `setup.mjs` はダッシュボード手順を stderr に印字して停止する
   （下記 7 参照）。
2. **`Cf-Access-Jwt-Assertion` が Worker まで届くか**
   Static Assets のルーターは `ctx.access` を渡さないので、認証はこのヘッダー
   の検証だけが頼り。デプロイ後にブラウザで開き、401
   `missing_token` が出るようなら Access がヘッダーを付けていない。
   その場合は Access アプリケーションの destination 設定を疑う。
   `cf-access-authenticated-user-email` は署名されていない参考値であって、
   検証の代わりにはならない。

---

## 7. Access アプリケーションが API で作れなかったとき

`setup.mjs` は Cloudflare がリクエストの形を拒否した場合、推測で作り直さずに
ダッシュボードでの手順を印字して終了する。表示どおりに

1. Zero Trust → Access → Applications → Add an application → Self-hosted
2. 名前は `yoki-artifact`、destination に Worker `yoki-artifact` を選ぶ
   （Worker が選べないアカウントでは `yoki-artifact.<subdomain>.workers.dev`
   を hostname として指定する）
3. Cookie settings で HTTP Only を有効にする

まで手で作ってから `node scripts/setup.mjs` を再実行する。名前で見つけて
ポリシーとサービストークンから続きをやる。

---

## 8. 動作確認

```sh
cat ~/.config/yoki-artifact/config.json
```

- `accessAud` が `REPLACE-...` でない実 UUID になっている
- `accessGroupId` が入っている（`share` / `unshare` がこれを読む。5-7）
- `workerUrl` が `https://yoki-artifact.<subdomain>.workers.dev`
- `wrangler.toml` の `SERVICE_TOKEN_NAME` が `REPLACE-...` でなく、
  `serviceTokenClientId` と同じ値になっている（5-6）
- そのURLをブラウザで開くと Cloudflare Access のログイン画面が出て、Google か
  GitHub でログインでき、`OWNER_EMAIL` のアカウントなら一覧が見える
- 許可していないアドレスでログインすると Access が弾く（Worker まで来ない）

---

## 9. 撤去

```sh
node scripts/teardown.mjs --dry-run   # 消える対象を確認（ネットワークに触らない）
node scripts/teardown.mjs --yes       # 実行
```

対話プロンプトは無い。`--yes` だけが確認手段で、付けなければ何もせず終了する
（exit 2）。消えるもの:

- Access アプリケーション（配下のポリシーごと）
- Access グループ `yoki-artifact-viewers`
- サービストークン `yoki-artifact-cli`
- **D1 データベース（全アーティファクトのメタデータ）**
- **R2 バケット（公開した HTML の全バージョン）**
- Worker 本体

D1 と R2 は復元できない。R2 はオブジェクトが残っていると削除を拒否されるので、
先に空にする必要がある。1Password に入れたサービストークンの secret も
無効になるので消しておく。

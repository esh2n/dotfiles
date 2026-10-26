# yoki-artifactセットアップ手順

Cloudflare側の初期構築は「人がダッシュボードで一度だけやること」と
「`scripts/setup.mjs`がAPIでやること」に分かれる。前半を飛ばすと後半は
必ず失敗するので、上から順に読む。Terraformは使わない。

- 手動（この文書の前半）: Zero Trustのオンボーディング、GoogleとGitHubの
  IdP登録、R2の有効化、APIトークンの発行
- 自動（`scripts/setup.mjs`）: D1 / R2の作成、マイグレーション、デプロイ、
  Accessアプリケーションとポリシー、サービストークン、設定ファイルの書き込み

---

## 0. 前提

| 必要なもの | 確認方法 |
| --- | --- |
| Cloudflareアカウント（無料プランで足りる） | ダッシュボードにログインできる |
| Node.js 20以上 | `node --version` |
| pnpm | `pnpm --version` |
| プロジェクトに固定したwrangler | `pnpm add -D wrangler` → `pnpm exec wrangler --version` |

wranglerはグローバルに入れない。S7の前提どおりプロジェクトに固定し、
呼び出しは常に`pnpm exec wrangler ...`を使う（`setup.mjs`もそう呼ぶ）。

無料枠の上限は次のとおり。設計上ここに収まるが、超えると止まる。

- Workers: 100,000リクエスト/日、CPU 10ms/リクエスト
- D1: 読み取り500万行/日、書き込み10万行/日
- R2: 保存10GB

---

## 1. Zero Trustのオンボーディング（手動）

1. ダッシュボード → **Zero Trust** を開く。初回はチーム名（team name）を
   決めるよう促される。ここで決めた名前が **チームドメイン** になる。
   例: チーム名`acme` → `acme.cloudflareaccess.com`
2. プラン選択画面では **Free** を選ぶ。50ユーザーまで無料。支払い方法の
   登録は求められるが、Freeのままなら課金されない。
3. 決まったチームドメインを控える。あとで`ACCESS_TEAM_DOMAIN`に入れる。

チームドメインはZero Trust → **Settings → Custom Pages**（または
**Settings → General**）の "Team domain" で後からも確認できる。

---

## 2. IdP（Google / GitHub）の登録（手動）

Accessのログイン画面に出すIDプロバイダーを2つ登録する。どちらも
「先に相手側でOAuthアプリを作り、そのClient ID / SecretをCloudflareに
貼る」という同じ形になる。なお、既定の **One-time PIN**（メールに届く
ワンタイムコード）だけでも運用は成立する — Google / GitHubはあとから
追加でき、追加してもここまでの構築をやり直す必要はない。

IdPの登録画面はZero Trust → **Integrations → Identity providers**
（旧UIのSettings → Authentication → Login methodsは廃止された。
直接リンク:
`https://one.dash.cloudflare.com/?to=/:account/integrations/identity-providers`）。

Cloudflare側が要求するリダイレクトURIは **両方とも同じ**:

```
https://<team>.cloudflareaccess.com/cdn-cgi/access/callback
```

`<team>`は1で決めたチーム名。このURIはZero TrustのIdP追加画面にも
表示されるので、必ず画面に出ている実物をコピーする。

### 2-1. Google

1. [Google Cloud Console](https://console.cloud.google.com/) → プロジェクトを
   選ぶ（なければ作る）
2. **APIs & Services → OAuth consent screen** を設定する。個人利用なら
   User TypeはExternal、公開はしない（テストユーザーに自分を入れる）
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://<team>.cloudflareaccess.com`
   - Authorized redirect URIs: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
4. 発行された **Client ID** と **Client secret** を控える
5. Zero Trust → **Integrations → Identity providers → Add new → Google**
   に貼り、**Test** で緑になることを確認する

### 2-2. GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: `https://<team>.cloudflareaccess.com`
   - Authorization callback URL:
     `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
2. **Client ID** を控え、**Generate a new client secret** でsecretを発行して
   控える（secretはこの一度しか表示されない）
3. Zero Trust → **Integrations → Identity providers → Add new → GitHub**
   に貼り、**Test** で緑になることを確認する

> GitHubのIdPはメールアドレスを返す。Accessのポリシーはメールで判定する
> ので、GitHubアカウントのprimary emailが許可リストのアドレスと一致して
> いること。一致しないと「ログインはできるが403」になる。

---

## 3. R2の有効化（手動）

1. ダッシュボード → **R2** を開く
2. 初回のみ「支払い方法の登録」を求められる。登録してもFree tier
   （10GB / 月）の範囲では課金されない
3. ここでバケットを作る必要はない。`setup.mjs`が`yoki-artifact`を作る

R2を有効化しないまま`setup.mjs`を実行すると、バケット作成のAPIが
403で落ちる。

---

## 4. APIトークンの発行（手動）

ダッシュボード → **My Profile → API Tokens → Create Token**。テンプレート
**"Edit Cloudflare Workers"** を選ぶとWorkers ScriptsとWorkers R2 Storageの
編集権限が入るので、そこにD1とAccess系を足すのがいちばん速い
（Create Custom Tokenから手で6つ選んでもよい）。必要な権限は次のとおり。

| 種別 | 権限 | 何に使うか |
| --- | --- | --- |
| Account | **Workers Scripts: Edit** | `wrangler deploy` |
| Account | **Workers R2 Storage: Edit** | R2バケット作成 |
| Account | **D1: Edit**（D1 Write） | D1データベース作成、`d1 migrations apply --remote` |
| Account | **Access: Apps and Policies: Edit**（Write） | Accessアプリケーションとポリシーの作成 |
| Account | **Access: Organizations, Identity Providers, and Groups: Edit**（Write） | Accessグループの作成 |
| Account | **Access: Service Tokens: Edit** | サービストークン`yoki-artifact-cli`の作成。**無いとサービストークン作成が403で落ちる**（実機確認済み） |

日本語UIのダッシュボードではAccessの権限がさらに細かく分かれている
（Access: Apps / Access: Policies / Access: Identity Providers /
Access: Organizations / Access: Groups / Access: Service Tokens）。その場合は
上の表に対応する **Apps・Policies・Groups・Service TokensのEdit** を選ぶ。
Service Tokensは独立した権限で、他のAccess権限には含まれない。

- **Account Resources** は対象のアカウントに限定する
- 有効期限は付けてよい。切れたら再発行して環境変数を差し替えるだけ
- 発行後の値は一度しか表示されない。**1Passwordに保存する**

作成できたら、下の "Verify" ボタン（またはトークン一覧のVerify）で有効性を
確認しておく。

### `wrangler login`を使う代替

APIトークンを作らず、`pnpm exec wrangler login`のブラウザOAuthで
wranglerに権限を渡すこともできる。ただし:

- `wrangler login`が効くのはwranglerが叩く部分（deploy、D1マイグレーション）
  だけ。**Accessアプリケーション・グループ・サービストークンは
  `setup.mjs`がREST APIを直接叩くので、`CLOUDFLARE_API_TOKEN`は
  どちらにせよ必要**
- 両方設定した場合、wranglerは環境変数のトークンを優先する
- 対話ログインはCIや別マシンでは使えない。常用はAPIトークンにする

つまり`wrangler login`は「手元で試すときにwranglerの認証だけ楽をする」
選択肢であって、`setup.mjs`の前提を置き換えるものではない。

---

## 5. 自動セットアップ（`scripts/setup.mjs`）

### 5-1. 環境変数

4つすべてが必須。1つでも欠けると実行前に止まる。

```sh
export CLOUDFLARE_API_TOKEN=...            # 4 で作ったトークン。コミット禁止
export CLOUDFLARE_ACCOUNT_ID=...           # ダッシュボード右下 / Workers 概要
export ACCESS_TEAM_DOMAIN=acme.cloudflareaccess.com
export OWNER_EMAIL=you@example.com         # 唯一の書き込み権限者
```

`ACCESS_TEAM_DOMAIN`は`acme`だけでも、`https://acme.cloudflareaccess.com/`
でも受け付ける（正規化される）。`OWNER_EMAIL`はWorker側の
`OWNER_EMAIL` varにもそのまま入り、publish / revoke / shareを許される
唯一の人間になる。

### 5-2. 閲覧者リスト

`viewers.json`にメールアドレスのJSON配列を置く（`viewers.example.json`
をコピーする）。このファイルは`.gitignore`済み。

```json
["teammate@example.com"]
```

- ファイルが無ければ「閲覧者ゼロ」として進む（オーナーだけが見られる）
- `--viewers <path>`で別のファイルを指定できる
- 内容はAccessグループ`yoki-artifact-viewers`のincludeに反映される。
  リストから消したアドレスは次回実行でグループからも消える
- **`OWNER_EMAIL`は常にグループのincludeに含まれる**（作成時も更新時も）。
  CloudflareのAPIはincludeが空のグループを400
  （`include field should not be empty`）で拒否するため、閲覧者ゼロでも
  グループはオーナー 1人で作られる。あとで`viewers.json`を空にしても
  同じ理由で失敗しない

日常の共有は`viewers.json`の編集ではなく **`artifact share`**（5-7）を
使う。ただし`setup.mjs`はグループのincludeを`viewers.json`で**丸ごと
置き換える**。`share`で足したアドレスを恒久的に残したいなら
`viewers.json`にも書いておくこと。書き忘れると次の`setup.mjs`実行で
Accessグループから消える（D1側のviewers行は残るので、
「Workerは許すがAccessが弾く」状態になる）。

### 5-3. 実行

```sh
cd harness/tools/artifact-worker
pnpm add -D wrangler          # まだなら
node scripts/setup.mjs --dry-run
node scripts/setup.mjs
```

`--dry-run`は **ネットワークに一切触らない**。「何も存在しない状態」を仮定して
実行予定のAPI呼び出し・コマンド・書き込み内容をすべて表示する。ダミーの
トークンでも動くので、レビュー用に使える。

実行順は依存関係で決まっている（順番を入れ替えられない）。

1. D1データベース作成 → `wrangler.toml`の`database_id`を書き換え
2. R2バケット作成
3. `pnpm exec wrangler d1 migrations apply yoki-artifact --remote`
4. `pnpm exec wrangler deploy` — **AccessアプリケーションはWorkerを
   destinationに指定するので、先にWorkerが存在している必要がある**
5. Accessアプリケーション作成（`destinations: [{type:"worker",
   worker_id:"yoki-artifact"}]`）。この形が400（`12130 worker_id ... is
   invalid`）で拒否されるアカウントでは、自動で
   `type:"self_hosted"` + `domain:"yoki-artifact.<subdomain>.workers.dev"`
   の形にフォールバックして作り直す（subdomainは
   `GET /accounts/:id/workers/subdomain`で取る）。両方拒否されたときだけ
   ダッシュボード手順を印字して停止する（7参照）
6. Accessグループ`yoki-artifact-viewers`作成／更新
7. サービストークン`yoki-artifact-cli`作成
8. Allowポリシー（`OWNER_EMAIL` + `yoki-artifact-viewers`グループ）と
   Service Authポリシー（サービストークン）を作成
9. `wrangler.toml`の`[vars]`に`ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` /
   `OWNER_EMAIL` / `SERVICE_TOKEN_NAME`を書き込み
10. `pnpm exec wrangler deploy`（本物の`ACCESS_AUD`を載せて再デプロイ）
11. `~/.config/yoki-artifact/config.json`を書き込み
    （CLIが読む`baseUrl` / `clientId`と、別名の`workerUrl` /
    `serviceTokenClientId`、`accessGroupId`を含む）

### 5-4. 何度実行してもよい

リソースは **IDではなく名前**で探す。2回目以降は既存を見つけて作成を飛ばし、
`[skip] ... already exists`と表示する。壊れた途中状態から再実行して続きを
やらせるのが正しい直し方。

`ACCESS_AUD`と`SERVICE_TOKEN_NAME`が既に`wrangler.toml`と一致していれば、
9と10も飛ばす。

### 5-5. サービストークンのsecret

サービストークンのsecretは **作成直後に一度だけ** stderrに出る。
Cloudflare側からも二度と読めない。

- その場で **1Passwordに保存する**
- CLIから使うときは`ARTIFACT_CLIENT_SECRET`に入れる（旧名
  `YOKI_ARTIFACT_CLIENT_SECRET`も当面は読む）
- `~/.config/yoki-artifact/config.json`には **client idしか書かない**。
  secretはどのファイルにも書かれない
- 無くしたらローテーション（下記5-6）

### 5-6. `SERVICE_TOKEN_NAME` — オーナー権限を持つトークンの固定

**何を固定するか。** WorkerはサービストークンのJWTに入る`common_name`
クレーム（Accessはここにトークンの **Client ID** を入れる）を
`SERVICE_TOKEN_NAME` varと突き合わせ、**一致したときだけ** そのトークンを
オーナー扱いする。`setup.mjs`が`yoki-artifact-cli`の`client_id`を
`wrangler.toml`の`[vars]`に書き込む。

これが無かった頃は「Accessを通ったサービストークンなら何でもオーナー」
だったので、同じAccessアプリに2本目のサービストークンを足すだけで、
publish / revoke / share / 全チャンネル閲覧 / コメント既読化まで通ってしまった。
エッジのService Authポリシーはtoken_idを1本に固定しているが、
**そのポリシーを人が編集すれば増やせる**。Worker側でも固定する。

**未設定のときの挙動（fail-closed）。** `SERVICE_TOKEN_NAME`が空、または
`REPLACE-...`のままなら、**どのサービストークンもオーナーにならない**。
人間のログインは今までどおり動くが、CLIはpublish / revoke / shareで403
`not_owner`を返し、CSRFの免除も外れる。

> **既存デプロイを更新するときの注意**: このvarを入れずにデプロイすると
> CLIが403で止まる。**Workerのデプロイと`setup.mjs`の再実行はセットで
> 行う**（`node scripts/setup.mjs`がvarを書いて再デプロイまでやる）。
> 黙って全サービストークンを通し続けるより、止まって直すほうを選んでいる。

**ローテーション手順**（secretを無くした / 漏らしたとき）:

1. Zero Trust → Access → Service Authで`yoki-artifact-cli`を削除
2. `node scripts/setup.mjs`を再実行
   （新しいトークンを作り、新しい`client_id`を`SERVICE_TOKEN_NAME`に
   書いて再デプロイし、Service Authポリシーも張り直す）
3. stderrに一度だけ出る新しいsecretを1Passwordに保存し、
   `ARTIFACT_CLIENT_SECRET`を差し替える

古いトークンは削除された時点でエッジでもWorkerでも通らなくなる。

### 5-7. `artifact share`とAccessグループ

閲覧者の許可は **2つのリストが揃って初めて**成立する。

| リスト | 実体 | 誰が見るか |
| --- | --- | --- |
| D1の`viewers`行 | Worker内の`canRead()` | Worker |
| Accessグループ`yoki-artifact-viewers` | アカウント全体のAccessグループ | Cloudflareのエッジ |

D1だけ更新しても意味がない。**AccessがWorkerに到達する前に弾く**ので、
共有相手はページを開けない。逆にAccessグループだけ更新すると、エッジは
通すがWorkerが403を返す。

そこで`artifact share` / `unshare`が**唯一の入口**として両方を更新する。

1. D1を更新（`POST /api/artifacts/:channel/viewers`）
2. Accessグループをread-modify-writeで更新
   （`GET` → includeをマージ → `PUT`。メール以外のincludeルールは
   そのまま保持し、`name` / `exclude` / `require`も維持する）

そのためにCLIが必要とするもの:

```sh
export CLOUDFLARE_API_TOKEN=...     # 4 で作ったトークン（環境変数のみ）
export CLOUDFLARE_ACCOUNT_ID=...    # 未設定なら config.json の accountId
```

- AccessグループのIDは`~/.config/yoki-artifact/config.json`の
  **`accessGroupId`**。これは`setup.mjs`が書く。古いconfigで欠けている
  場合は`node scripts/setup.mjs`を再実行すれば入る
  （一時的に`ARTIFACT_ACCESS_GROUP_ID`で上書きもできる）

**3つのどれかが欠けている / Cloudflareが拒否したときは、`share`は
exit 2で止まり、手でやる手順をそのまま印字する。**「D1は更新済み」である
ことも明示する。黙って200を返して「共有できたつもり」にはさせない。
印字される選択肢は3つ:

1. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`を入れて同じコマンドを
   再実行する（D1側は冪等なので安全）
2. `artifact-worker/viewers.json`を直して`node scripts/setup.mjs`
3. ダッシュボード: Zero Trust → Access → Access Groups →
   `yoki-artifact-viewers`にEmailsのincludeルールを足す／消す

### 5-8. `ACCESS_AUD`をsecretにしたい場合

`setup.mjs`は`ACCESS_AUD`を`wrangler.toml`の`[vars]`に書く。AUDは
公開識別子（署名検証の対象であって、鍵ではない）なので既定はこれでよい。
リポジトリに書きたくない運用なら、`[vars]`の行を
`REPLACE-access-application-aud`に戻したうえで

```sh
pnpm exec wrangler secret put ACCESS_AUD
```

を使う。Worker側の`readConfig`はvarとsecretを区別しないので、
どちらでも動く。

### 5-9. コメントの差出人は読む人によって変わる

同じ1件のコメントでも、APIが返す差出人は**誰が読んでいるか**で違う。

| 読む人 | `author` | `author_display` |
| --- | --- | --- |
| オーナー（`OWNER_EMAIL` / 固定サービストークン = CLI） | 実アドレス | 仮名 |
| 共有相手（viewersに載っている人） | **返らない**（キーごと無い） | 仮名 |

仮名は`viewer-<16進8桁>`で、`sha256(アドレス + チャンネル名)`の先頭4
バイト。チャンネル名を混ぜてあるので、**同じ人でもチャンネルが違えば別の
仮名**になる。1つのページで「この仮名は誰か」が割れても、他のページの同じ
人には結び付かない。同じチャンネルの中では安定なので、スレッドをまたいで
「同じ人の発言」であることは分かる。

解決者（`resolved_by` / `resolved_by_display`）も同じ扱い。例外は
エージェントの返信の`agent via <owner>`で、これは個人ではなく役割なので
誰にでもそのまま見える（オーナーのアドレスはもともとこの表示で公開している）。

`viewers`リストそのものが共有相手に返らないのと同じ理由で、
**ページを1枚共有されたことは「他に誰が共有されているか」を知る理由に
ならない**。

---

## 6. 初回に必ず確認すること

S7のspikeでUNVERIFIEDだった項目のうち、1は2026-09の実機セットアップで
確認済み。2はデプロイごとに確認する。

1. **`destinations`のworker指定がAPIで通るか — 実機確認済み**
   このアカウントでは400（`12130 worker_id "yoki-artifact" is invalid`）で
   拒否され、`self_hosted` + workers.dev hostnameの形は通った。`setup.mjs`は
   この順で自動フォールバックする。両方拒否された場合のみダッシュボード手順を
   stderrに印字して停止する（下記7参照）。
2. **`Cf-Access-Jwt-Assertion`がWorkerまで届くか**
   Static Assetsのルーターは`ctx.access`を渡さないので、認証はこのヘッダー
   の検証だけが頼り。デプロイ後にブラウザで開き、401
   `missing_token`が出るようならAccessがヘッダーを付けていない。
   その場合はAccessアプリケーションのdestination設定を疑う。
   `cf-access-authenticated-user-email`は署名されていない参考値であって、
   検証の代わりにはならない。

---

## 7. AccessアプリケーションがAPIで作れなかったとき

`setup.mjs`はworker destinationの形が拒否されると、まずworkers.dev
hostnameの形（`self_hosted` + `domain`）で自動的に作り直す。**両方**
拒否された場合だけ、推測を重ねずにダッシュボードでの手順を印字して終了する。
表示どおりに

1. Zero Trust → Access → Applications → Add an application → Self-hosted
2. 名前は`yoki-artifact`、destinationにWorker `yoki-artifact`を選ぶ
   （Workerが選べないアカウントでは`yoki-artifact.<subdomain>.workers.dev`
   をhostnameとして指定する）
3. Cookie settingsでHTTP Onlyを有効にする

まで手で作ってから`node scripts/setup.mjs`を再実行する。名前で見つけて
ポリシーとサービストークンから続きをやる。

---

## 8. 動作確認

```sh
cat ~/.config/yoki-artifact/config.json
```

- `accessAud`が`REPLACE-...`でない実UUIDになっている
- `accessGroupId`が入っている（`share` / `unshare`がこれを読む。5-7）
- `baseUrl`（と別名の`workerUrl`）が
  `https://yoki-artifact.<subdomain>.workers.dev`
- `clientId`（と別名の`serviceTokenClientId`）が入っている
- `wrangler.toml`の`SERVICE_TOKEN_NAME`が`REPLACE-...`でなく、
  `serviceTokenClientId`と同じ値になっている（5-6）
- そのURLをブラウザで開くとCloudflare Accessのログイン画面が出て、Googleか
  GitHubでログインでき、`OWNER_EMAIL`のアカウントなら一覧が見える
- 許可していないアドレスでログインするとAccessが弾く（Workerまで来ない）

---

## 9. 撤去

```sh
node scripts/teardown.mjs --dry-run   # 消える対象を確認（ネットワークに触らない）
node scripts/teardown.mjs --yes       # 実行
```

対話プロンプトは無い。`--yes`だけが確認手段で、付けなければ何もせず終了する
（exit 2）。消えるもの:

- Accessアプリケーション（配下のポリシーごと）
- Accessグループ`yoki-artifact-viewers`
- サービストークン`yoki-artifact-cli`
- **D1データベース（全アーティファクトのメタデータ）**
- **R2バケット（公開したHTMLの全バージョン）**
- Worker本体

D1とR2は復元できない。R2はオブジェクトが残っていると削除を拒否されるので、
先に空にする必要がある。1Passwordに入れたサービストークンのsecretも
無効になるので消しておく。

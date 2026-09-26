# 持ち主の手順（2026-09-27）

Mac の移行の仕上げと、Omarchy 機を初めて入れるところまで。上から順に進める。各手順に「何のため」「どこで」「打つもの」「うまくいったかの見分け方」を書く。

前提:

- リポジトリは Mac の `~/go/github.com/esh2n/dotfiles`。私（Claude）の作業は同じリポジトリのブランチ `work-2026-09-23` にある。
- 1Password の vault は `llm-automation`。LiteLLM は、その vault だけを読めるサービスアカウントで鍵を読む。
- 決定の中身は `harness/rules/decisions/2026-09-27-deterministic-falls-back-to-the-mac.md`。

---

## A. Mac（今すぐできること）

### A1. MiMo と DeepSeek を比べる

何のため: MiMo-V2.6-Flash を今の `main`（deepseek-flash）と同じ問題で測る。

どこで: Mac のターミナル、どこからでも。

```
bash ~/go/github.com/esh2n/dotfiles/.claude/worktrees/harness-parity/home/shared/litellm/config/bench/mimo-vs-deepseek.sh
```

見分け方: 最後に `wrote …/report-mimo-vs-deepseek.md` と出る。その中身を Claude に見せる。

うまくいかないとき:

- `could not resolve op://llm-automation/xiaomi/credential` と出たら、1Password の項目の名前か欄の名前が違う。1Password で Xiaomi の項目を開き、右上の「…」→「Copy Secret Reference」で参照をコピーし、先頭に付けて打ち直す:
  ```
  XIAOMI_REF='op://llm-automation/<項目>/<欄>' bash ~/go/github.com/esh2n/dotfiles/.claude/worktrees/harness-parity/home/shared/litellm/config/bench/mimo-vs-deepseek.sh
  ```
- `no 1Password service-account token` と出たら、LiteLLM が使っているトークンが Keychain に無い。LiteLLM が今動いているなら起きないはず。

### A2. llama-server の API キーを 1Password に作る

何のため: Omarchy 機の llama-server は、このキーを知っている相手にしか答えない。Omarchy 機の llama-server と、全部の機械の LiteLLM が同じキーを読む。

どこで: Mac の 1Password アプリ。

手順:

1. vault `llm-automation` を開き、「+ New Item」→「API Credential」。
2. タイトルを `llama-server` にする（小文字、ハイフン）。
3. 「credential」の欄に、推測されない長い文字列を入れる。ターミナルで `openssl rand -hex 32` を打つと 64 文字の文字列が出るので、それを貼る。
4. 保存する。

見分け方: ターミナルで次を打ち、64 文字が出れば正しい（出たものはどこにも貼らない）。

```
op read op://llm-automation/llama-server/credential | wc -c
```

`64` か `65`（末尾の改行の有無）と出ればよい。`op` がサインインを求めたら、1Password アプリの承認に従う。

### A3. main を進めて GitHub に上げる

何のため: Omarchy 機はこのリポジトリを GitHub から取ってくる。今、Mac の main は GitHub より 333 コミット進んでいて、私の作業はさらに 21 コミット先のブランチにある。push の前に、上げていない 349 コミットを gitleaks で確かめ、秘密情報は 0 件だった（リポジトリは公開）。

どこで: Mac のターミナル。

```
cd ~/go/github.com/esh2n/dotfiles
git merge --ff-only work-2026-09-23
git push origin main
```

見分け方:

- 1 行目の後に `Fast-forward` と出る。`Not possible to fast-forward` と出たら止めて Claude に見せる。
- 3 行目の後に `main -> main` と出る。

補足: main への push は、私（Claude）はガードで止められていてできない。あなたが打つ。

### A4. ghostty の古いリンクを直して `make up`

何のため: `~/.config/ghostty` が、前の世代の「フォルダごとのリンク」のまま残っている。そのせいで、新しい設定のリンクがリポジトリの古いフォルダ `home/darwin/ghostty/config/` の中に作られている。今は正しく動いているが、次の世代でも同じ所に書かれる。あわせて、移動の前に残った古いフォルダを片付ける。

どこで: Mac のターミナル。herdr と ghostty を終了してから。

```
ls -ld ~/.config/ghostty
```

`~/.config/ghostty -> /nix/store/…` のように `->` が付いていれば、それはリンクなので消してよい。

```
rm ~/.config/ghostty
cd ~/go/github.com/esh2n/dotfiles
rm -r home/darwin/ghostty/config home/darwin/herdr/config home/darwin/browsers
make up
```

- `rm` はゴミ箱に移すだけなので、間違えても戻せる。
- `home/darwin/ghostty/config` は古い場所。今の ghostty の設定は `home/shared/ghostty/` と `home/darwin/ghostty/platform` にある。
- `home/darwin/herdr/config` には、古い herdr のソケットとログしか残っていない。
- `home/darwin/browsers` には、以前生成した userstyle しか残っていない（今は `home/shared/browsers` で作り直される）。

見分け方: `make up` が最後まで通ったあと、

```
ls -ld ~/.config/ghostty
```

`drwx…` で始まる（リンクではなくフォルダになる）。ghostty を開いて、見た目がいつもどおりならよい。

---

## B. Omarchy 機（初めて入れる）

### B1. tailnet に入れる

何のため: Mac と Omarchy 機は tailnet（Tailscale のネットワーク）越しにモデルを使い合う。

どこで: Omarchy 機のターミナル。

```
omarchy-install-service-tailscale
```

ブラウザが開いたら、Mac と同じアカウントでログインする。

見分け方と、この機械の名前の控え方:

```
tailscale status --json | jq -r .Self.DNSName
```

`desktop.tail1234.ts.net.` のような名前が出る。最後の `.` を除いたもの（例: `desktop.tail1234.ts.net`）を控える。以下では **Omarchy 機の名前** と呼ぶ。

Mac の名前も控える。Mac のターミナルで同じコマンドを打つ（例: `mac.tail1234.ts.net`）。以下では **Mac の名前** と呼ぶ。

### B2. 1Password のサービスアカウントのトークンを保存する

何のため: LiteLLM と llama-server は、人のいないところで 1Password から鍵を読む。そのためのトークンを、この機械の鍵の保管場所（gnome-keyring）に一度だけ入れる。

どこで: Omarchy 機。トークンの値は、Mac のセットアップのときに 1Password に保存したもの（サービスアカウントを作ったときに表示されたトークン、`ops_…` で始まる）。Omarchy には 1Password アプリが入っているので、そこで開いてコピーする。

```
secret-tool store --label='1Password service account' service litellm-op-token
```

`Password:` と聞かれるので、トークンを貼って Enter。

見分け方:

```
secret-tool lookup service litellm-op-token | cut -c1-4
```

`ops_` と出ればよい（全体は表示しない）。

### B3. docker を sudo なしで使えるようにする

何のため: LiteLLM は docker のコンテナで動く。Omarchy の既定では、あなたのユーザーは docker グループに入っていない。

```
omarchy-setup-security-sudoless-docker
```

その後、一度ログアウトしてログインし直す。

見分け方: `docker ps` が `permission denied` を出さずに一覧（空でもよい）を出す。

### B4. リポジトリを取ってくる

A3 の push が済んでから。

```
mkdir -p ~/go/github.com/esh2n
git clone https://github.com/esh2n/dotfiles.git ~/go/github.com/esh2n/dotfiles
```

見分け方: `ls ~/go/github.com/esh2n/dotfiles/bootstrap.sh` がファイルを出す。

### B5. Nix を入れる

何のため: この dotfiles は Nix で組み立てる。`bootstrap.sh` は Nix が無ければ入れて止まる。

```
cd ~/go/github.com/esh2n/dotfiles
bash bootstrap.sh
```

途中で sudo のパスワードを聞かれる。最後に `Nix is installed. Open a new shell (so nix is on PATH) and run make up again.` と出て止まる。ここではまだ `make up` を打たない。新しいターミナルを開く。

見分け方: 新しいターミナルで `nix --version` が版を出す。

### B6. NVIDIA ドライバの版とハッシュを調べる

何のため: Nix で作った llama-server（CUDA）は、Omarchy が入れたドライバと同じ版のライブラリを使う必要がある。その版と、配布ファイルのハッシュを役割ファイルに書く。

```
nvidia-smi --query-gpu=driver_version --format=csv,noheader
```

`580.82.09` のような版が出る。以下 `<版>` と書く。

```
nix --extra-experimental-features nix-command store prefetch-file https://download.nvidia.com/XFree86/Linux-x86_64/<版>/NVIDIA-Linux-x86_64-<版>.run
```

数百 MB をダウンロードしたあと、`hash 'sha256-…'` と出る。`sha256-…` の部分を控える。

### B7. 役割ファイルを書く

何のため: この機械が何をするかを決める。書かないまま `make up` を打つと、何も変えずに止まって書き方を示す。

```
mkdir -p ~/.config/dotfiles
nvim ~/.config/dotfiles/roles.json
```

中身（`<…>` を控えたもので置き換える）:

```json
{
  "roles": ["developer", "desk-user", "model-provider"],
  "nvidia": {
    "version": "<版>",
    "sha256": "<sha256-…>",
    "acceptLicense": true
  },
  "llamaServerHost": "<Omarchy 機の名前>",
  "lmStudioHost": "<Mac の名前>",
  "observerHost": "<Mac の名前>"
}
```

- `developer`: コーディングエージェント（Claude Code、Codex、pi、omp）と jig、この機械の LiteLLM。
- `desk-user`: 人が座って使う機械のフォントやアプリ。
- `model-provider`: この機械の GPU で llama-server を動かし、tailnet に出す。
- `acceptLicense: true`: NVIDIA のドライバのライブラリを使うことへの同意。内容は https://www.nvidia.com/en-us/drivers/nvidia-license/ 。同意しない場合は `model-provider` を外す。
- `llamaServerHost`: deterministic の行き先（この機械自身）。
- `lmStudioHost`: この機械の llama-server が落ちているときの deterministic の行き先（Mac）。この機械の電源が切れているときは、この機械の LiteLLM も止まっているので関係しない。
- `observerHost`: 利用料の台帳がある機械（Mac）。この機械の LiteLLM の使用額をそこへ送る。

### B8. `make up`

```
cd ~/go/github.com/esh2n/dotfiles
make up
```

- 初回は長い。Nix のパッケージに加えて、Qwen3.8-27B（17.4GB）を `~/models` にダウンロードする。
- `make` が無いと言われたら、`bash bootstrap.sh` で同じことになる。
- 途中で止まったら、同じコマンドをもう一度打てば続きから進む（何度打っても同じ結果になる作り）。

見分け方:

- 画面の下に bar が移っている。
- ghostty を開くと Omarchy のテーマの色になっている。
- `ls -lh ~/models` に `Qwen3.8-27B-Q4_K_M.gguf`（約 17GB）がある。

### B9. 確かめる

```
dotctl llm check --repo ~/go/github.com/esh2n/dotfiles --gpu
```

`--gpu` は「この機械は llama-server を出している」という意味（役割ファイルではなく、この引数で何を確かめるかが決まる）。

`FAIL` の行があれば、出力をそのまま Claude に見せる。とくに見たいのは次の三つ:

- `tier deterministic` の行（この機械の LiteLLM から、tailnet 越しに自分の llama-server に届くか）。
- `tailscale serve 8080 (llama-server)` の行。
- `Docker engine answers` の行。

---

## C. Mac（Omarchy 機が動いてから）

### C1. Mac の役割ファイルに Omarchy 機の名前を足す

```
nvim ~/.config/dotfiles/roles.json
```

今の中身は `{"roles":["developer","desk-user","model-provider","observer"]}`。次のようにする:

```json
{
  "roles": ["developer", "desk-user", "model-provider", "observer"],
  "llamaServerHost": "<Omarchy 機の名前>"
}
```

Mac 自身には `lmStudioHost` と `observerHost` は要らない（LM Studio も台帳も自分の中にある）。

```
cd ~/go/github.com/esh2n/dotfiles
make up
dotctl llm check --repo ~/go/github.com/esh2n/dotfiles --lmstudio --console
```

`--lmstudio` は「この機械は LM Studio を出している」、`--console` は「この機械が observer（Grafana と台帳）」という意味。

見分け方: `tier deterministic` が PASS。`deterministic falls back to LM Studio's qwen/qwen3.8-27b@4bit` が PASS（LM Studio のサーバーが動いているとき）。

### C2. フォールバックを一度試す

Omarchy 機を Windows で起動する（または電源を切る）。60 秒待ってから Mac で:

```
dotctl llm check --repo ~/go/github.com/esh2n/dotfiles --lmstudio --console
```

`tier deterministic` が PASS のままなら、Mac が代わりに答えている。最初の一回は LM Studio が Qwen を読み込むので、しばらく待つことがある（何秒かを控えておいて Claude に教えてほしい）。Grafana の「deterministic: どちらが答えたか」で、`:1234` の線が伸びる。

### C3. Mac で大きいモデルを動かすとき

LM Studio のアプリで読み込むか、要求で呼ぶ（JIT）。`lms load` で常駐させない。常駐させると、Omarchy 機が止まったときに Qwen と両方が載ってメモリが足りなくなる。

### C4. （任意）使わなくなった Homebrew の CLI を消す

```
brew uninstall sesh rtk ollama thefuck hunk mo protoc-gen-go-grpc herdr wtp omp diffnav ov staticcheck golangci-lint govulncheck
brew uninstall --cask codex
```

入っていないものがあると `No such keg` と出るが、無視してよい。herdr・wtp・omp・codex・diffnav・ov・staticcheck・golangci-lint・govulncheck は Nix から入るようになったので、消しても使える。

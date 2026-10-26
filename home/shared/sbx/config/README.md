# sbx — エージェントをmicroVMに閉じ込めて走らせる

`claude`はホストで走る。`yclaude`は [Docker Sandboxes](https://www.docker.com/products/docker-sandboxes/)
のmicroVMの中で走る。**`y`を頭に付けるかどうかだけが操作の差**で、中身は
`jig apply --target <harness> --write`が配る同じハーネス(hooks/rules/skills/workflows)。

なぜVMかというと、`Bash(rm -rf ...)`のようなdeny listはシェルに対しては
構造的に回避できるから — `cd ~/x && rm -rf .`、`$HOME`、スクリプト経由、
`find -delete`、python。言い換えを全部潰すことはできない。microVMは逆に
**渡したものしか見えない** allow listなので、そこが破れない。

```
domains/dev/bin/yoki-box          本体。yclaude / ycodex / yomp / ygemini / yopencode / yfetch は全部これへの symlink
home/shared/sbx/config/kits/
├── postures/{guarded,connected}  何を渡すか(信頼の姿勢)
└── agents/{claude,codex,omp}     中で何を用意するか(エージェント固有)
```

kitは`--kit`を複数回渡せるので、**posture × agent** の掛け算で組み合わせる。
エージェントを1つ増やすのはsymlink 1本、必要ならkit 1つ。

## 使い方

```bash
yclaude              # guarded  (既定)
yclaude -d           # direct
yclaude -c           # connected
yclaude -- --continue   # -- の後ろはエージェントにそのまま渡る
yfetch               # サンドボックスのブランチをホストに取り込む
yfetch <name>        # 同じ作業ディレクトリに複数ある時は名前で指定
```

`YOKI_BOX_DRY_RUN=1`を付けると実行せず`sbx`の起動コマンドだけ出す。
どのモードが何を渡すかは、これを見るのが一番早い。

## 3つのモード

| | ファイル | 認証情報 | 成果物の取り出し | 使う場面 |
|---|---|---|---|---|
| **guarded**(既定) | `--clone`したVM内の複製 | なし | `yfetch` | 素性の分からないコード、並列で回す実装 |
| **direct** (`-d`) | ホストの実ファイルを直接編集 | なし | 不要(その場が成果物) | ローカルで個人開発。fetchが面倒な時 |
| **connected** (`-c`) | `--clone`した複製 | GitHub | エージェントがpushしてPR | 人が見ていない間に実装 → PRレビュー |

`--clone`はVM内にgitの複製を作る。ホストの作業ツリーは読み取り専用のまま
なので、**消される事故は起きない**。ただし`--clone`が止めるのは「破壊」で
あって「漏洩」ではない: `/run/sandbox/source`にはリポジトリ全体がread-onlyで
マウントされるので`cat /run/sandbox/source/.env`は通る。持ち出しを止めるのは
ネットワークポリシーだけ(後述)。

**guardedで作った成果物の取り出し方**が`yfetch`。VM内のgit daemon
(sandbox側9418番)からホストが直接fetchし、`sandbox-<name>/<branch>`として
リモート追跡ブランチに積む。GitHubを経由しないので、`connected`にしなくても
ローカルのmainにマージできる。

```bash
yfetch
git log --oneline main..sandbox-claude-myrepo/feature-x
git merge sandbox-claude-myrepo/feature-x
```

> ホスト側のポートは**サンドボックスを起動するたびに変わる**。`yoki-box`は
> 毎回`sbx ls --json`から引き直していて、決してキャッシュしない。手で
> `git remote add`して固定すると次回壊れる。

## モードを選ぶ基準

VMの境界は **破壊を止めるが、判断を代行しない**。プロンプトインジェクション
された結果の「もっともらしい操作」はVMの中でも実行される。それを止めるのは
Claude Code側の`auto`モード(分類器が毎回の操作を審査する)で、これは
`claude-profiles/core/settings.layer.json`の`permissions.defaultMode`から
来る。kit側では設定していない。

つまり **「素性の分からないコードだからbypassPermissionsで放り込む」は逆**。
VMに入れる理由と、審査を外す理由は別物。

`connected`だけはGitHub認証がVMの外に届く = 境界の外側なので、
そこを守るのは`auto`と`git-guard.sh`(mainへのpushとforce pushをdeny)
の2枚だけになる。

## エージェント間の非対称性(重要)

同じpostureでも、**エージェントごとに既定の緩さが違う**:

| エージェント | 既定の姿勢 | 出どころ |
|---|---|---|
| Claude Code | `auto` — 分類器が毎操作を審査 | dotfilesのsettings layer |
| Codex | `approval_policy = "never"` / `sandbox_mode = "danger-full-access"` | **sbxが作成時に書く`~/.codex/config.toml`**(コメントに "yolo mode" と明記) |

ompの非対称性は`agents/omp/spec.yaml.in`の "WHY THIS KIT EXISTS" を参照。

Codexには`auto`に相当する設定キーがない。`on-request`は「モデルが自分で
聞くか決める」なのでインジェクション下では機能せず、`untrusted`は全部聞いて
くる。一番近いのは起動フラグ`--approve-for-me`(自動レビュー)なので、
気になる場面では自分で渡す:

```bash
ycodex -- --approve-for-me
```

sbxが書くconfigにはmcp-gatewayの設定も同居しているため、kit側から
`config.toml`を上書きはしていない(上書きするとMCPが黙って切れる)。

## kitの書き方 / 増やし方

- ファイル名は`spec.yaml`固定。`schemaVersion: "2"`と`kind: mixin`が必須
- `sbx kit validate <dir>`で検証できる
- v2に**エージェントへの指示文を書く場所はない**(`agentContext` /
  `agentInstructions`はv1)。姿勢は`~/.claude/CLAUDE.md`経由で渡る
- **`spec.yaml.in`にするのは、ホストの絶対パスを埋め込む必要がある時だけ**。
  サンドボックスはリポジトリをホスト側のパスのままマウントするため
  (`/Users/...`がVM内にそのまま生える)、`{{DOTFILES_ROOT}}`の展開が要る。
  **展開は`yoki-box`が起動時に`$TMPDIR`へ行い、リポジトリには書き戻さない**
  — 絶対パスは特定のチェックアウトに属するので、生成物として設置すると
  worktreeから起動した瞬間に嘘になる。拡張子が`.template`ではなく`.in`
  なのは、テンプレートの展開（render-templates）の対象から外すため
- `yoki-box`はこの`spec.yaml.in`の有無で挙動を変える:
  - **ある** → dotfilesの3ディレクトリ(`core/`, `domains/dev/bin/`,
    `domains/dev/config/claude-profiles/`)をread-onlyでマウントし、
    起動後にホストの有効パックを同期する
  - **ない**(素の`spec.yaml`) → 自己完結したkitとみなして何もマウントしない

リポジトリ全体をマウントしないのは、`home/shared/harness/claude/`の下に
**過去のセッション記録が約1.7GBある**から。中で動くものに全部見せる必要はない。

## ベースイメージにあるもの / ないもの

2026-08-15実測(Ubuntu、ユーザー `agent`、ホーム`/home/agent`。Claude版・
Codex版とも同じ):

- **ある**: node v22 / git / jq / python3 / rg / bash / npm / npx / uv / gh / curl
- **ない**: zsh / mise / fd / bun — kitのinstallはこの4つを埋める

jigはbunプログラムなので、kitは`npm install -g bun`でbunを入れ、
`/usr/local/bin/bun`に置く(hooksが受け取る素のPATHにnpmのglobal binは
無い)。その後`jig apply --target <harness> --write`で ~/.claudeなどを配る。

## ネットワーク

グローバルのBalancedポリシーが**既に192ドメインを許可**している(主要な
パッケージレジストリ全部と`**.github.com`を含む)。なのでkitでallowを
足すのはほぼ冗長で、逆に絞ろうとするとdenyの追いかけっこになる。
本気で締めるなら`sbx policy init`でLocked Downにしてから足し戻す。

kitにallowが書いてあるのは、Locked Downにした時に壊れないようにするため。
`mise.run`が`mise.jdx.dev`に302で飛ぶことは、**ポリシーログを読んで**分かった:

```bash
sbx policy log     # default-deny に当たったホスト名がそのまま出る
```

## 認証

**API課金は不要。サブスクリプションのOAuthで通る。**
`sbx secret set anthropic`は設定せずに`yclaude`を起動し、中で`/login`。
`sbx secret set --oauth`がopenai専用なのは事実だが、それが効くのは
プロキシ経路であってClaude Code自身のログインではない。
(これを壊していたdocker/for-mac#7842はDocker Desktop 4.60.1で修正済み)

`connected`で使うGitHubトークンは`sbx secret set github`でホスト側に置く。
プロキシが注入するので、値そのものはVMに入らない。

## 落とし穴

- **`--no-share-skills`は必須**。付けないとsbxがホスト側のskillsストアを
  `~/.claude/skills`にread-writeでマウントし、`jig apply`が
  マウントポイントを置き換えられず "Device or resource busy" で落ちる。
  sbxのセキュリティ文書でもサンドボックス間の書き込み穴として挙がっている。
  `sbx create`時のフラグなのでkitには書けない — `yoki-box`が常に付けている
- **パックは無い**。jigにパックの概念は無く、rulesは`paths:` frontmatter、
  skillsは判断サービスが選ぶので、kitは`jig apply`一発でホストと同じ中身になる
- **同じ作業ディレクトリに複数のサンドボックス**があると`yfetch`の対象が
  曖昧になる。起動中のものを優先し、それでも複数なら名前を要求して止まる

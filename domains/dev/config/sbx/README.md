# sbx — エージェントを microVM に閉じ込めて走らせる

`claude` はホストで走る。`yclaude` は [Docker Sandboxes](https://www.docker.com/products/docker-sandboxes/)
の microVM の中で走る。**`y` を頭に付けるかどうかだけが操作の差**で、中身は
`claude-switch` が組み立てた同じ yoki ハーネス(hooks/rules/skills/workflows)。

なぜ VM かというと、`Bash(rm -rf ...)` のような deny list はシェルに対しては
構造的に回避できるから — `cd ~/x && rm -rf .`、`$HOME`、スクリプト経由、
`find -delete`、python。言い換えを全部潰すことはできない。microVM は逆に
**渡したものしか見えない** allow list なので、そこが破れない。

```
domains/dev/bin/yoki-box          本体。yclaude / ycodex / ygemini / yopencode / yfetch は全部これへの symlink
domains/dev/config/sbx/kits/
├── postures/{guarded,connected}  何を渡すか(信頼の姿勢)
└── agents/{claude,codex}         中で何を用意するか(エージェント固有)
```

kit は `--kit` を複数回渡せるので、**posture × agent** の掛け算で組み合わせる。
エージェントを1つ増やすのは symlink 1本、必要なら kit 1つ。

## 使い方

```bash
yclaude              # guarded  (既定)
yclaude -d           # direct
yclaude -c           # connected
yclaude -- --continue   # -- の後ろはエージェントにそのまま渡る
yfetch               # サンドボックスのブランチをホストに取り込む
yfetch <name>        # 同じ作業ディレクトリに複数ある時は名前で指定
```

`YOKI_BOX_DRY_RUN=1` を付けると実行せず `sbx` の起動コマンドだけ出す。
どのモードが何を渡すかは、これを見るのが一番早い。

## 3つのモード

| | ファイル | 認証情報 | 成果物の取り出し | 使う場面 |
|---|---|---|---|---|
| **guarded**(既定) | `--clone` した VM 内の複製 | なし | `yfetch` | 素性の分からないコード、並列で回す実装 |
| **direct** (`-d`) | ホストの実ファイルを直接編集 | なし | 不要(その場が成果物) | ローカルで個人開発。fetch が面倒な時 |
| **connected** (`-c`) | `--clone` した複製 | GitHub | エージェントが push して PR | 人が見ていない間に実装 → PR レビュー |

`--clone` は VM 内に git の複製を作る。ホストの作業ツリーは読み取り専用のまま
なので、**消される事故は起きない**。ただし `--clone` が止めるのは「破壊」で
あって「漏洩」ではない: `/run/sandbox/source` にはリポジトリ全体が read-only で
マウントされるので `cat /run/sandbox/source/.env` は通る。持ち出しを止めるのは
ネットワークポリシーだけ(後述)。

**guarded で作った成果物の取り出し方**が `yfetch`。VM 内の git daemon
(sandbox 側 9418番)からホストが直接 fetch し、`sandbox-<name>/<branch>` として
リモート追跡ブランチに積む。GitHub を経由しないので、`connected` にしなくても
ローカルの main にマージできる。

```bash
yfetch
git log --oneline main..sandbox-claude-myrepo/feature-x
git merge sandbox-claude-myrepo/feature-x
```

> ホスト側のポートは**サンドボックスを起動するたびに変わる**。`yoki-box` は
> 毎回 `sbx ls --json` から引き直していて、決してキャッシュしない。手で
> `git remote add` して固定すると次回壊れる。

## モードを選ぶ基準

VM の境界は **破壊を止めるが、判断を代行しない**。プロンプトインジェクション
された結果の「もっともらしい操作」は VM の中でも実行される。それを止めるのは
Claude Code 側の `auto` モード(分類器が毎回の操作を審査する)で、これは
`claude-profiles/core/settings.layer.json` の `permissions.defaultMode` から
来る。kit 側では設定していない。

つまり **「素性の分からないコードだから bypassPermissions で放り込む」は逆**。
VM に入れる理由と、審査を外す理由は別物。

`connected` だけは GitHub 認証が VM の外に届く = 境界の外側なので、
そこを守るのは `auto` と `git-guard.sh`(main への push と force push を deny)
の2枚だけになる。

## エージェント間の非対称性(重要)

同じ posture でも、**エージェントごとに既定の緩さが違う**:

| エージェント | 既定の姿勢 | 出どころ |
|---|---|---|
| Claude Code | `auto` — 分類器が毎操作を審査 | dotfiles の settings layer |
| Codex | `approval_policy = "never"` / `sandbox_mode = "danger-full-access"` | **sbx が作成時に書く `~/.codex/config.toml`**(コメントに "yolo mode" と明記) |

Codex には `auto` に相当する設定キーがない。`on-request` は「モデルが自分で
聞くか決める」なのでインジェクション下では機能せず、`untrusted` は全部聞いて
くる。一番近いのは起動フラグ `--approve-for-me`(自動レビュー)なので、
気になる場面では自分で渡す:

```bash
ycodex -- --approve-for-me
```

sbx が書く config には mcp-gateway の設定も同居しているため、kit 側から
`config.toml` を上書きはしていない(上書きすると MCP が黙って切れる)。

## kit の書き方 / 増やし方

- ファイル名は `spec.yaml` 固定。`schemaVersion: "2"` と `kind: mixin` が必須
- `sbx kit validate <dir>` で検証できる
- v2 に**エージェントへの指示文を書く場所はない**(`agentContext` /
  `agentInstructions` は v1)。姿勢は `~/.claude/CLAUDE.md` 経由で渡る
- **`spec.yaml.in` にするのは、ホストの絶対パスを埋め込む必要がある時だけ**。
  サンドボックスはリポジトリをホスト側のパスのままマウントするため
  (`/Users/...` が VM 内にそのまま生える)、`{{DOTFILES_ROOT}}` の展開が要る。
  **展開は `yoki-box` が起動時に `$TMPDIR` へ行い、リポジトリには書き戻さない**
  — 絶対パスは特定のチェックアウトに属するので、生成物として設置すると
  worktree から起動した瞬間に嘘になる。拡張子が `.template` ではなく `.in`
  なのは、`core/config/manager.sh` の生成対象から外すため
- `yoki-box` はこの `spec.yaml.in` の有無で挙動を変える:
  - **ある** → dotfiles の3ディレクトリ(`core/`, `domains/dev/bin/`,
    `domains/dev/config/claude-profiles/`)を read-only でマウントし、
    起動後にホストの有効パックを同期する
  - **ない**(素の `spec.yaml`) → 自己完結した kit とみなして何もマウントしない

リポジトリ全体をマウントしないのは、`domains/dev/config/claude/` の下に
**過去のセッション記録が約1.7GB ある**から。中で動くものに全部見せる必要はない。

## ベースイメージにあるもの / ないもの

2026-08-15 実測(Ubuntu、ユーザー `agent`、ホーム `/home/agent`。Claude 版・
Codex 版とも同じ):

- **ある**: node v22 / git / jq / python3 / rg / bash / npm / npx / uv / gh / curl
- **ない**: zsh / mise / fd — kit の install はこの3つを埋めるだけ

node が最初から入っているので、`run-with-flags.js` を叩く9本の core hook は
追加の準備なしで動く。

## ネットワーク

グローバルの Balanced ポリシーが**既に192ドメインを許可**している(主要な
パッケージレジストリ全部と `**.github.com` を含む)。なので kit で allow を
足すのはほぼ冗長で、逆に絞ろうとすると deny の追いかけっこになる。
本気で締めるなら `sbx policy init` で Locked Down にしてから足し戻す。

kit に allow が書いてあるのは、Locked Down にした時に壊れないようにするため。
`mise.run` が `mise.jdx.dev` に302で飛ぶことは、**ポリシーログを読んで**分かった:

```bash
sbx policy log     # default-deny に当たったホスト名がそのまま出る
```

## 認証

**API 課金は不要。サブスクリプションの OAuth で通る。**
`sbx secret set anthropic` は設定せずに `yclaude` を起動し、中で `/login`。
`sbx secret set --oauth` が openai 専用なのは事実だが、それが効くのは
プロキシ経路であって Claude Code 自身のログインではない。
(これを壊していた docker/for-mac#7842 は Docker Desktop 4.60.1 で修正済み)

`connected` で使う GitHub トークンは `sbx secret set github` でホスト側に置く。
プロキシが注入するので、値そのものは VM に入らない。

## 落とし穴

- **`--no-share-skills` は必須**。付けないと sbx がホスト側の skills ストアを
  `~/.claude/skills` に read-write でマウントし、`claude-switch` が
  マウントポイントを置き換えられず "Device or resource busy" で落ちる。
  sbx のセキュリティ文書でもサンドボックス間の書き込み穴として挙がっている。
  `sbx create` 時のフラグなので kit には書けない — `yoki-box` が常に付けている
- **パックは kit に書かない**。有効パックはマシン固有の選択で
  (`~/.claude/.claude-packs`、23個から選ぶ)、リポジトリの `packs.default` は空。
  kit に列挙するとパックが増えた瞬間に陳腐化するので、`yoki-box` が起動後に
  ホストの設定を読んで同じものを有効化する
- **同じ作業ディレクトリに複数のサンドボックス**があると `yfetch` の対象が
  曖昧になる。起動中のものを優先し、それでも複数なら名前を要求して止まる

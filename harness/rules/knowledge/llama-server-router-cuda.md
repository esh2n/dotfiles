# llama-server の router モードを systemd --user + CUDA でどう運用するか

確認日: 2026-09-25

## 答え

llama-server の router モードは現行 README で骨格が確定している。モデル未指定で起動し、`--models-dir` / `--models-preset` / `LLAMA_CACHE` の3系統からモデルを探す。選択は POST ボディの `model` フィールド、GET は `?model=` クエリ。`--models-max`（既定4）を超えると自動アンロードが働くが、原文に「LRU」という語は無く、評価基準は二次情報（Hugging Face のブログ）に依存する。`--sleep-idle-seconds`（既定 -1 = 無効）でアイドル時にモデルと KV キャッシュを RAM から解放できるが、少なくとも2件の未解決不具合が残る: `/metrics` へのポーリングがアイドルタイマーをリセットしてしまう疑い、およびスリープ後もサブプロセスが GPU メモリを約600MiB 保持し続ける不具合。どちらも closed as not planned のまま。`--metrics` は router モードでは `?model=` クエリが無いと 400 を返す。

CUDA バイナリの入手経路は3通りで一長一短がある。nixpkgs の `cudaSupport=true` は stable チャンネル向けの公開バイナリキャッシュが無く、standalone home-manager はドライバ機構（`/run/opengl-driver/lib` 相当）を自前で解決する必要がある。AUR の `llama.cpp-cuda`（無印）は現存せず、代替の `llama.cpp-cuda-git` は投票6・運用9か月弱の新しいパッケージで、Arch 公式 `extra` リポジトリには llama.cpp 系が一切無い。公式 GitHub Releases は日次の nightly（prerelease）で Linux 向け CUDA プリビルドバイナリを継続配布しており、実地では最も手数が少ない経路になる。ただし「安定版」タグにはバイナリが付かない。

`loginctl enable-linger` は systemd --user サービスをログイン前（無ログイン）から常駐させる標準機構で、GPU 対応の類似ツールがこの手順を明記している。ただし対象機での GPU アクセス可否を実測した一次報告は見つかっていない。

## 根拠

- llama-server routerモード仕様、`--models-max`/`--sleep-idle-seconds`/`--metrics` の挙動 — https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md
- アイドル解放の不具合（`/metrics` ポーリング） — https://github.com/ggml-org/llama.cpp/issues/23096（closed, not planned）
- スリープ後も GPU メモリが解放されない不具合 — https://github.com/ggml-org/llama.cpp/issues/19379（closed, not planned）
- AUR の `llama.cpp-cuda-git`（投票6、2026-01作成、2026-09-14更新） — AUR RPC API（`aur.archlinux.org/rpc/v5`）
- nixpkgs CUDA キャッシュが stable チャンネルを公式にはカバーしないという議論 — https://discourse.nixos.org/t/cuda-cache-for-nix-community/56038
- 公式 nightly が Linux CUDA プリビルドバイナリを継続配布 — GitHub Releases API（`api.github.com/repos/ggml-org/llama.cpp/releases`）
- `loginctl enable-linger` をログイン前起動の標準手順として明記する類似ツール — https://github.com/highercomve/highllama

## 注意点

- 同じ世代の GPU・Arch + standalone home-manager の組み合わせで `cudaSupport=true` を実際にビルド／デプロイした一次報告は見つからなかった。
- `loginctl enable-linger` 環境下で GPU（`nvidia-smi` 等）に問題なくアクセスできることを実機で確認した一次報告は見つからなかった。GPU ドライバがカーネルモジュールとして常時ロードされることからの推測に留まる。
- `--models-max` 到達時の挙動が本当に LRU 基準かどうかは README 原文では確認できず、二次情報（ベンダーブログ）にのみ現れる。
- nixpkgs の CUDA バイナリキャッシュに関する「stable 向けの公開キャッシュが無い」という情報はコミュニティの議論スレッド止まりで、一次発表ページには到達していない。

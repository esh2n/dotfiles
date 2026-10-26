# llama-serverのrouterモードをsystemd --user + CUDAでどう運用するか

確認日: 2026-09-25

## 答え

llama-serverのrouterモードは現行READMEで骨格が確定している。モデル未指定で起動し、`--models-dir` / `--models-preset` / `LLAMA_CACHE`の3系統からモデルを探す。選択はPOSTボディの`model`フィールド、GETは`?model=`クエリ。`--models-max`（既定4）を超えると自動アンロードが働くが、原文に「LRU」という語は無く、評価基準は二次情報（Hugging Faceのブログ）に依存する。`--sleep-idle-seconds`（既定 -1 = 無効）でアイドル時にモデルとKVキャッシュをRAMから解放できるが、少なくとも2件の未解決不具合が残る: `/metrics`へのポーリングがアイドルタイマーをリセットしてしまう疑い、およびスリープ後もサブプロセスがGPUメモリを約600MiB保持し続ける不具合。どちらもclosed as not plannedのまま。`--metrics`はrouterモードでは`?model=`クエリが無いと400を返す。

CUDAバイナリの入手経路は3通りで一長一短がある。nixpkgsの`cudaSupport=true`はstableチャンネル向けの公開バイナリキャッシュが無く、standalone home-managerはドライバ機構（`/run/opengl-driver/lib`相当）を自前で解決する必要がある。AURの`llama.cpp-cuda`（無印）は現存せず、代替の`llama.cpp-cuda-git`は投票6・運用9か月弱の新しいパッケージで、Arch公式`extra`リポジトリにはllama.cpp系が一切無い。公式GitHub Releasesは日次のnightly（prerelease）でLinux向けCUDAプリビルドバイナリを継続配布しており、実地では最も手数が少ない経路になる。ただし「安定版」タグにはバイナリが付かない。

`loginctl enable-linger`はsystemd --userサービスをログイン前（無ログイン）から常駐させる標準機構で、GPU対応の類似ツールがこの手順を明記している。ただし対象機でのGPUアクセス可否を実測した一次報告は見つかっていない。

## 根拠

- llama-server routerモード仕様、`--models-max`/`--sleep-idle-seconds`/`--metrics`の挙動 — https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md
- アイドル解放の不具合（`/metrics`ポーリング） — https://github.com/ggml-org/llama.cpp/issues/23096（closed, not planned）
- スリープ後もGPUメモリが解放されない不具合 — https://github.com/ggml-org/llama.cpp/issues/19379（closed, not planned）
- AURの`llama.cpp-cuda-git`（投票6、2026-01作成、2026-09-14更新） — AUR RPC API（`aur.archlinux.org/rpc/v5`）
- nixpkgs CUDAキャッシュがstableチャンネルを公式にはカバーしないという議論 — https://discourse.nixos.org/t/cuda-cache-for-nix-community/56038
- 公式nightlyがLinux CUDAプリビルドバイナリを継続配布 — GitHub Releases API（`api.github.com/repos/ggml-org/llama.cpp/releases`）
- `loginctl enable-linger`をログイン前起動の標準手順として明記する類似ツール — https://github.com/highercomve/highllama

## 注意点

- 同じ世代のGPU・Arch + standalone home-managerの組み合わせで`cudaSupport=true`を実際にビルド／デプロイした一次報告は見つからなかった。
- `loginctl enable-linger`環境下でGPU（`nvidia-smi`等）に問題なくアクセスできることを実機で確認した一次報告は見つからなかった。GPUドライバがカーネルモジュールとして常時ロードされることからの推測に留まる。
- `--models-max`到達時の挙動が本当にLRU基準かどうかはREADME原文では確認できず、二次情報（ベンダーブログ）にのみ現れる。
- nixpkgsのCUDAバイナリキャッシュに関する「stable向けの公開キャッシュが無い」という情報はコミュニティの議論スレッド止まりで、一次発表ページには到達していない。

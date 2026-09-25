---
question: "Omarchy(Arch, RTX 3090 Ti)機でsystemd --userのllama-server routerモードをどう起動するか — (1)routerモードの現行CLIと--api-key/--metrics/アイドル解放の実際の挙動、(2)CUDA対応バイナリの入手経路をnixpkgs cudaSupport/AURのllama.cpp-cuda系/公式リリースの3通りで比較、(3)ログイン前起動とGPUアクセスの両立"
date: 2026-09-25
verdict: "(1) routerモードは現行READMEに一次情報として確定している。`llama-server`をモデル未指定で起動、`--models-dir`/`--models-preset`/`LLAMA_CACHE`の3系統からモデルを探す。選択はPOSTボディの`model`フィールド、GETは`?model=`クエリ。`--models-max`既定4でLRU的にキャパオーバー時アンロード(README原文に明示的な『LRU』という語は無く『automatically unload』相当の記述)。アイドル解放は`--models-max`到達時の自動アンロードとは別に`--sleep-idle-seconds`(PR #18228, 既定-1=無効)という独立の仕組みがあり、`GET /health`/`/props`/`/models`/`/metrics`の4エンドポイントは明示的にアイドルタイマーをリセットしない『除外』対象とREADMEが明記——ただし同じ仕組みについて『/metricsがオートロードを誘発しスリープを妨げる』という不具合報告(#23096)が実在し、closed as not plannedのまま残っている(READMEの現行記述と食い違う可能性を否定できない)。加えて『routerモードのサブプロセスはsleep-idle-seconds後もGPUに約600MiB居座り続ける』という別の不具合(#19379)もclosed as not plannedで未解決。`--api-key`と`--metrics`はrouterモード専用の除外規定がREADMEに見当たらず全体設定として適用されるが、`--metrics`だけは`?model={model_id}`クエリが無いと400を返すというrouterモード特有の制約がある。(2) 3経路を比較すると: nixpkgs `cudaSupport=true`はnix-community/cuda-maintainersのバイナリキャッシュが`nixos-unstable-small`系列しか公開キャッシュを持たず、stableチャンネル向けの公開キャッシュは無い(2024年開始のnix-community cachixに加え、後続コメントでNix/Flox/NVIDIA間の合意により『stableブランチ向けの新規公開キャッシュは無い』と明言)——flakeがstableをpinする前提とは噛み合わずソースビルドになりやすい。さらにhome-manager standaloneはNixOS本体が持つ`/run/opengl-driver/lib`を持たないため`libcuda.so`のドライババージョン一致を自分で解決する必要があり(nixGL/addDriverRunpath/手動symlink)、Ubuntu上で試した実践者の質問スレッドは3つの対策(nixGL, nix-gl-host, nix-system-graphics)を提示されたが『これで確実に動いた』という結論には至っていない。AURの`llama.cpp-cuda`(無印)は現存せず、代替は`llama.cpp-cuda-git`(6票、2026-01作成、2026-09-14更新、`ggml-cuda-git`を置き換えた新パッケージ)のみで、Arch公式extraリポジトリにllama.cpp系パッケージは0件。対して公式GitHub Releasesは`llama-bNNNNN-bin-ubuntu-cuda-12.8-x64.tar.gz`のようなLinux CUDAプリビルドバイナリを日次(ナイトリーのprerelease)で継続的に公開しており、これが最も手数が少なく更新頻度も高い。実践者の記録(nijho.lt)ではNixOS本体上でCUDA有効化ビルドが機能している例が確認できたが、これはNixOS(non-standalone)であり今回のOmarchy(Arch+standalone home-manager)構成とは前提が異なる。(3) `loginctl enable-linger $USER`はsystemd --userサービスをログイン前(起動時)から常駐させるための標準機構であり、GPU自体へのアクセス可否とは別次元——GPUドライバはカーネルモジュールとして常時ロードされているため、通常はrootログインの有無とは独立してuser unitからでもアクセスできる。ただしこれはGPU一般論の推測であり[unverified]、3090 Ti個体・Omarchy(Arch)固有でlinger+GPUの組み合わせを検証した一次報告は見つからなかった。近縁ツール`highllama`(NVIDIA/AMD/macOS対応のllama-server風ラッパー)は`install.sh --systemd`がuser unitを作り、READMEが`loginctl enable-linger $USER`をログイン無しで動かすための手順として明記している——これは実地の先例として扱える。"
unverified:
  - "3090 Ti個体でOmarchy(Arch, standalone home-manager)上にnixpkgs cudaSupport=trueのllama-cppを実際にビルド/デプロイした一次報告 — 検索した範囲では一般的なnon-NixOS+home-manager+GPUドライバの苦労話(discourse #60557、Ubuntu例)しか見つからず、Arch/Omarchy固有・3090 Ti個体の報告は無い"
  - "loginctl enable-lingerで起動したsystemd --userサービスがGPU(nvidia-smi経由)に問題なくアクセスできることを実機で確認した一次報告 — highllamaのREADMEはlinger手順を明記するが、GPUアクセス可否を明示的に検証した記述ではない"
  - "llama-server routerモードの`--models-max`到達時アンロードが本当にLRU(最も使われていないモデル)基準かの一次README原文の該当箇所 — READMEを直接grepしたが『LRU』という語自体は見当たらず、二次情報(Hugging Faceブログ)の『least-recently-used model unloads』という要約に依存している"
  - "README上『/metricsはアイドルタイマーをリセットしない』という現行記述と、#23096(『/metricsがオートロードしタイマーをリセットする』closed as not planned)の食い違いがいつ・どちらの記述が正しく解消されたのか — 両者の時系列関係(READMEの記述がバグ修正を反映した後の状態なのか、#23096の再現条件が別にあるのか)は確認できていない"
  - "nix-community/cuda-maintainersキャッシュのstableチャンネルに関する『2026年時点での正式な後継キャッシュ』の有無 — discourseスレッド上のコメント(2次情報)止まりで、Nix/Flox/NVIDIA間の合意の一次発表ページには到達していない"
sources_note: "WebFetch/WebSearchを併用。AURのRPC API(aur.archlinux.org/rpc/v5)とGitHub REST API(api.github.com)はcurlで直接叩いた(通常のAURウェブページはAnubis botプロテクションでWebFetch到達不能だったため)。llama-server READMEはraw.githubusercontent.com経由でファイル全体をダウンロードしgrep/sedで該当箇所を抽出した一次情報。前提記録(2026-09-24-two-host-home-llm.md、2026-09-24-vllm-vs-llama-server.md)で確立済みの事実(llama-serverの`--api-key`/`-np`/`-sm`基本仕様、Ollama並列既定1、CUDA非決定性、router mode公開日2025-12-11)は再確認せず引用のみ。"
---

# llama-server routerモードの現行CLIとCUDAパッケージング経路 — 調査記録

**調査日**: 2026-09-25。決定記録 [[../decisions/2026-09-24-home-llm-second-host-omarchy-llama-server.md]] が「Omarchy機はsystemd --userのllama-server routerモード、`--api-key`、`--metrics`、tailnetへ`tailscale serve --tcp`一本」「マシン構成管理はstandalone home-manager(Nix flake)、Nixはmulti-userでpacmanと共存」を採用済み。本記録はその実装詳細(routerモードの現行フラグ、CUDAバイナリの入手経路、ログイン前起動)を3問に分けて埋める。前提記録が確立済みの事実(llama-serverが認証・並列・GPU分割を単体で持つ唯一のサーバー、router mode 2025-12-11公開、Ollama並列既定1、CUDA自体の非決定性)は再調査しない。

## 方法と検証凡例

- WebFetch: 該当ページを直接取得し要約。「verbatim」はページ本文からの逐語引用。
- WebSearch: 検索結果のスニペット経由。可能な限り個別URLをWebFetchで再確認した。未再確認のものは「WebSearch経由」と明記。
- `raw.githubusercontent.com`から`tools/server/README.md`全文をダウンロードし、`grep`/`sed`で該当行を直接抽出した(2,138行、一次情報そのもの)。
- AURの通常ウェブページ(`aur.archlinux.org/packages/...`)はAnubis botプロテクションでWebFetchが到達不能だったため、AUR公式RPC API(`aur.archlinux.org/rpc/v5`)をcurlで直接叩いて構造化データ(投票数・最終更新日・メンテナ)を取得した。
- GitHub REST API(`api.github.com`)をcurlで直接叩き、リリースのアセット一覧を確認した。
- 到達不能は「[到達不能]」と明記。

---

## 1. ベンダー

### 1.1 llama-server routerモード — 現行CLI(一次情報、README全文から直接抽出)

出典: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md [WebFetch/curl、2,138行全文取得、2026-09-25時点のmasterブランチ]

- **起動方法**[verbatim]: 「`llama-server` can be launched in a **router mode** that exposes an API for dynamically loading and unloading models. The main process (the "router") automatically forwards each request to the appropriate model instance.」「To start in router mode, launch `llama-server` **without specifying any model**」
- **モデルソース3系統**[verbatim]: 「1. Cached models (controlled by the `LLAMA_CACHE` environment variable) 2. Custom model directory (set via the `--models-dir` argument) 3. Custom preset (set via the `--models-preset` argument)」。cacheへの追加は`llama-server -hf <user>/<model>:<tag>`、追加後は「*The server must be restarted after adding a new model.*」——**router自体は無停止で切替できるが、新規モデルの「登録」自体はサーバー再起動が要る**という制約。
- **主要フラグ**(READMEのフラグ表、212-244行、verbatim):
  - `--api-key KEY`: 「API key to use for authentication, multiple keys can be provided as a comma-separated list (default: none)(env: LLAMA_API_KEY)」
  - `--api-key-file FNAME`: 「path to file containing API keys, one per line; lines starting with a hash are treated as comments (default: none)」
  - `--metrics`: 「enable prometheus compatible metrics endpoint (default: disabled)(env: LLAMA_ARG_ENDPOINT_METRICS)」
  - `--models-dir PATH`: 「directory containing models for the router server (default: disabled)(env: LLAMA_ARG_MODELS_DIR)」
  - `--models-preset PATH`: 「path to INI file containing model presets for the router server (default: disabled)(env: LLAMA_ARG_MODELS_PRESET)」
  - `--models-max N`: 「for router server, maximum number of models to load simultaneously (default: 4, 0 = unlimited)(env: LLAMA_ARG_MODELS_MAX)」
  - `--models-autoload, --no-models-autoload`: 「for router server, whether to automatically load models (default: enabled)(env: LLAMA_ARG_MODELS_AUTOLOAD)」
  - `--sleep-idle-seconds SECONDS`: 「number of seconds of idleness after which the server will sleep (default: -1; -1 = disabled)」
- **モデル選択の実際の口**[verbatim、1795行]: 「By default, the model will be loaded automatically if it's not loaded. To disable this, add `--no-models-autoload` when starting the server. Additionally, you can include `?autoload=true|false` in the query param to control this behavior per-request.」——POSTボディの`model`フィールド、GETは`?model=`クエリという構造は、Hugging Faceブログ(1.2節参照)の要約と一致することをREADME原文でも確認。
- **`--models-max`到達時の挙動**: README原文中に「LRU」「least-recently-used」という単語そのものは見当たらなかった[gap]。ただし挙動としては「maximum number of models to load simultaneously」という上限管理の記述があり、二次情報(Hugging Faceブログ、1.2節)が「least-recently-used model unloads」と要約している——**一次原文でLRUという語を確認できていない点は留保[unverified]**。
- **`--metrics`のrouterモード制約**[verbatim、1124行]: 「This endpoint is only accessible if `--metrics` is set.」「In *router mode* the query param `?model={model_id}` has to be set. This endpoint will respond with status code 400 `model name is missing from the request` if not set.」——**routerモードでは`/metrics`単体では叩けず、モデルを明示しないと400になる**。
- **アイドルスリープ(`--sleep-idle-seconds`)の詳細**[verbatim、2071-2081行]: 「The server supports an automatic sleep mode that activates after a specified period of inactivity (no incoming tasks). This feature, introduced in [PR #18228](https://github.com/ggml-org/llama.cpp/pull/18228), can be enabled using the `--sleep-idle-seconds` command-line argument. It works seamlessly in both single-model and multi-model configurations.」「When the server enters sleep mode, the model and its associated memory (including the KV cache) are unloaded from RAM to conserve resources. Any new incoming task will automatically trigger the model to reload.」「The sleeping status can be retrieved from the `GET /props` endpoint (or `/props?model=(model_name)` in router mode).」
- **アイドルタイマーの除外エンドポイント**[verbatim、直後の行]: 「Note that the following endpoints are exempt from being considered as incoming tasks. They do not trigger model reloading and do not reset the idle timer: `GET /health` / `GET /props` / `GET /models` / `GET /metrics`」——**現行READMEは`/metrics`をアイドルタイマーの外に明示的に置いている**(Prometheusが定期的に叩いてもスリープを妨げない設計として文書化されている)。

### 1.2 llama-server routerモード — Hugging Faceブログ(二次情報、公式発信だがHF上の記事)

出典: https://huggingface.co/blog/ggml-org/model-management-in-llamacpp [WebFetch]

- 「The `model` field in your request determines which model handles it.」「`"ggml-org/gemma-3-4b-it-GGUF:Q4_K_M"`」という形式例。
- 「When you hit `--models-max` (default: 4), the least-recently-used model unloads.」——README原文には出てこない「least-recently-used」という具体的な評価基準はこのブログ記事にのみ現れる[要留保、1.1節参照]。
- マルチプロセス設計: 「if one model crashes, others remain unaffected」。

---

## 2. 実践者

### 2.1 llama-server routerモードのアイドル/メトリクス周りの不具合報告(実践者が起票)

- **GET /metricsがオートロードを誘発しスリープを妨げる**[https://github.com/ggml-org/llama.cpp/issues/23096、closed as not planned、WebFetch]: 報告者曰く「all GET endpoints that accept a model parameter route through proxy_get, which validates the model with autoload enabled」——`?model=`付きGETリクエストがrouter内部の`ensure_model_ready`を経由してしまい、監視用の定期ポーリング(Prometheus scrape等)がそのままアイドルタイマーをリセットし続けてスリープが発火しない、という報告。**closed as not plannedのまま未解決**——現行READMEの「/metricsは除外」という記述(1.1節)と食い違う可能性があり、この不一致自体は本調査では解消できなかった[unverified]。
- **routerモードのサブプロセスがsleep後もGPUに居座る**[https://github.com/ggml-org/llama.cpp/issues/19379、closed as not planned、WebFetch]: 「the child subprocess unloads the model from VRAM but the process remains alive and attached to the GPU, consuming ~600MiB per idle subprocess.」——**`--sleep-idle-seconds`はRAM/KVキャッシュは解放するが、routerが立てた子プロセス自体はGPUコンテキストを保持したまま残り、モデルごとに約600MiBが返らないという実測付きの負の証拠**。closed as not plannedのため恒久的に残るリスクとして記録。
- **アイドルアンロード機能要求そのもの**[https://github.com/ggml-org/llama.cpp/issues/18189、closed as not planned、WebFetch]: 「Models current sit loaded until the max loaded models are met, using up system resources.」という動機で`--unload-idle-seconds`相当を要求——これ自体はclosed as not plannedだが、後続で`--sleep-idle-seconds`(PR #18228)という別名の機構が実装され現行READMEに載っている。**機能要求チケットとしては「not planned」で閉じられても、名前を変えた別実装が後から入ることがある**という運用上の教訓。

### 2.2 systemd --userでのllama-server系ラッパー(linger手順込み)

出典: https://github.com/highercomve/highllama [WebFetch]

- 「`./install.sh --systemd` installs an optional systemd **user** unit.」——system unitではなくuser unit。
- 「Works on NVIDIA (CUDA), AMD (ROCm or Vulkan), and macOS (Metal or MLX)」——GPU対応を明記。
- linger手順[verbatim]: 「`loginctl enable-linger $USER`           # ...or even without logging in」——**ログイン前(または無ログイン)起動のための標準手順として実地に明記されている**。ただしGPUアクセス可否そのものを明示的に検証した記述ではない[unverified]。

### 2.3 NixOS本体でのCUDA有効化ビルド(参考、standalone home-managerとは前提が異なる)

出典: https://www.nijho.lt/post/llama-nixos/ [WebFetch]

- Nixオーバーライドで`cudaSupport = true`、`blasSupport = true`、`NIX_ENFORCE_NO_NATIVE`無効化により初期8 tok/sから50 tok/sへ改善したという実測付きの実践者記録。
- systemdサービスは`User = "basnijholt"`のuser-level実行、`LD_LIBRARY_PATH`に`/run/opengl-driver/lib`を含む——**これはNixOS本体(non-standalone)のドライバ機構に依存しており、Omarchy(Arch)+standalone home-managerでは`/run/opengl-driver/lib`自体が存在しないため、この記事の手順はそのまま使えない**(3.2節参照)。

### 2.4 home-manager standalone + GPU(non-NixOS)の実践者の苦労

出典: https://discourse.nixos.org/t/home-manager-and-graphic-drivers-on-non-nixos-desktop/60557 [WebFetch]

- 実践者の報告[verbatim]: 「I am struggling to set up my config to run programs (kitty, alacritty, or wezterm) or a desktop environment such as hyprland that require graphic drivers (here an Nvidia GPU).」
- nixGLを試したエラー[verbatim]: 「[glfw error 65542]: EGL: Failed to get EGL display: Success」
- 返信は`nix-gl-host`・`nix-system-graphics`という別ツールを提案するに留まり、**スレッド内で「これで確実に解決した」という確定報告は無い**——**non-NixOS(Ubuntu例だがArchも同型)でhome-managerからGPU依存パッケージを扱う一般的な摩擦の実例**。

---

## 3. 測定

### 3.1 AUR — llama.cpp-cuda系パッケージの投票数・更新状況(一次データ、AUR RPC API直接取得)

出典: `curl https://aur.archlinux.org/rpc/v5/search?arg=llama.cpp&by=name` [2026-09-25実行、一次データ]

| パッケージ | 投票数 | Popularity | メンテナ | 備考 |
|---|---|---|---|---|
| `llama.cpp-cuda`(無印) | — | — | — | **検索結果0件、現存しない** |
| `llama.cpp-cuda-git` | 6 | 0.55 | Bink | FirstSubmitted 2026-01-08、LastModified 2026-09-14、`ggml-cuda-git`を`Replaces`(旧パッケージからの置き換え) |
| `llama.cpp-git`(CUDA限定でない汎用) | 14 | 0.0(popularity計算上0扱い) | lapsus | — |
| `llama.cpp-cuda-aidock-bin` | 0 | 0 | mdrv | プリビルドバイナリ版、投票0 |
| `llama.cpp-cuda-essentials-only` | 0 | 0 | slyfox1186 | 投票0 |

- Arch公式`extra`リポジトリ検索[https://archlinux.org/packages/?q=llama.cpp、WebFetch]: 「0 matching packages found」——**llama.cpp系は公式リポジトリに一切無く、AUR専業**。
- ArchWiki Talkページ・AURウェブページ本体はAnubis botプロテクションでWebFetch到達不能[到達不能]。ただしWebSearchのスニペットは「llama.cpp-cuda package long out of date」(Archフォーラムスレッド)、「llama.cpp-cuda AUR package is gone」という要約を返しており、AUR RPC APIの直接データ(無印`llama.cpp-cuda`が検索0件)と整合する。
- **`llama.cpp-cuda-git`は6票・2026年1月作成の比較的新しいパッケージで、9か月弱の運用実績しかない**——AURパッケージとしては薄い部類(参考: 前回記録で扱った他のAURパッケージとの相対比較は今回していない[gap])。

### 3.2 nixpkgs CUDAバイナリキャッシュの範囲(一次情報+二次情報)

出典: https://discourse.nixos.org/t/cuda-cache-for-nix-community/56038 [WebFetch]

- 当初(2024年11月)のアナウンス: `nix-community.cachix.org`が`nixos-unstable-small`系列のCUDA有効化パッケージをキャッシュ、公開鍵`nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs=`。
- 後続コメント(スレッド内、二次情報寄り): 現行の公式キャッシュ候補として`cache.nixos-cuda.org`の名が挙がるが、「there is no more cache for NixOS stable branches」——**stableチャンネルに対する公開バイナリキャッシュは無い**、という趣旨のコメントが記録されている。
- **含意**: Omarchy機のflakeでnixpkgs stableをpinした場合、`cudaSupport=true`のllama-cppはキャッシュヒットせずソースビルドになりやすい。unstableへの追従が必要になるが、それは他のパッケージのpin方針(flake全体の安定性)とのトレードオフになる[この裏取りは本調査の範囲外、gap]。

### 3.3 公式GitHub Releases — Linux CUDAプリビルドバイナリの実在確認(一次データ、GitHub REST API直接取得)

出典: `curl https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=5` [2026-09-25実行]

- 直近5リリース(すべて`prerelease: true`、日次のnightlyタグ、例: `b11160`〜`b11156`、2026-09-24付)は一貫して以下のアセットを含む:
  - `llama-bNNNNN-bin-ubuntu-cuda-12.8-x64.tar.gz`
  - `llama-bNNNNN-bin-ubuntu-cuda-13.4-x64.tar.gz`(arm64版も別途あり)
  - `cudart-llama-bNNNNN-bin-ubuntu-cuda-12.8-x64.tar.gz`(CUDAランタイム同梱版)
- 一方、`tag_name: v0.5.0`(2026-09-23、「latest」としてAPIが返す安定版タグ)のアセットは`nightly-tag.txt`の1件のみで、**独立したLinux CUDAバイナリを含んでいなかった**——**「latest」の安定版タグより、日次更新されるnightly(prerelease)の方が実体を持つビルド配布経路になっている**という現行の配布実態[gap: なぜ安定版タグにバイナリが付かないのか、リリースプロセスの一次説明には未到達]。
- WebSearchで見つかったコミュニティ発の代替配布(`ai-dock/llama.cpp-cuda`、`starskyzheng/llamaup`)は、いずれも「official llama.cpp releases ship pre-built Windows CUDA binaries but nothing for Linux CUDA」という説明を掲げていたが、**今回の直接データ確認では、公式リリース自体がUbuntu向けCUDAプリビルドバイナリ(nightly)を継続的に配布していることを確認**——コミュニティ側の説明は古いか不正確である可能性が高い[この矛盾自体の理由は未検証]。

### 3.4 `loginctl enable-linger` — GPUアクセスとの関係(一般論、機種固有の実測なし)

出典: WebSearchスニペット複数(NixOS Wiki, Oracle Linux docs等、個別ページ未全確認) + highllama README(2.2節、再掲)

- 一般的な定義: 「`loginctl enable-linger $USER` tells systemd-logind to keep that user's systemd --user manager running even without an active login session, allowing enabled user services to start at boot and keep running after logout.」
- GPU一般論としては、NVIDIAカーネルドライバはブート時にロードされ特定ユーザーセッションに紐付かないため、user unitからのGPUアクセスはlingerの有無自体とは独立に成立するはずという推測が成り立つが、**この持ち主の3090 Ti・Omarchy固有の実測報告は見つからず[unverified]**。highllama README(2.2節)がlinger手順をGPU対応ツールの標準セットアップとして明記していることが、実地での間接的な裏付けとなる。

---

## 4. 実地(in the wild)

### 4.1 llama-server routerモードを実運用しているリポジトリ

- `mostlygeek/llama-swap`(★5,742、前回記録で確認済み、再掲)——router mode登場前からモデル切替プロキシとして機能してきたツールで、llama-server自体のrouter mode登場後の位置づけの変化(併存/代替のどちらか)は本調査では深掘りしていない[gap]。
- `deepwiki.com/cuolm/pi-sbx-llamacpp`(WebSearchで表面化したDeepWiki生成ドキュメント、二次情報かつAI生成の可能性がある解説ページ)——router modeの解説記事が存在すること自体は2026年時点でのコミュニティ関心の高さを示すが、内容の一次性は低いため引用は見出しのみに留める[unverified扱い]。

### 4.2 AUR — llama.cpp-cuda-gitのConflicts/Provides(一次データ)

出典: AUR RPC API(3.1節、再掲)

- `llama.cpp-cuda-git`のメタデータ[verbatim(JSON)]: `"Conflicts":["llama.cpp","libggml","ggml","ggml-cuda-git"]`、`"Depends":["cuda","curl","gcc-libs","glibc","nvidia-utils","openssl"]`——**インストール時に無印`llama.cpp`パッケージや旧`ggml-cuda-git`と衝突する設計であり、他のGPUバックエンド(Vulkan版等)と共存させるには工夫が要る**という実地上の制約。

---

## サマリー表

| 出典 | task/対象 | 数値 | 既知の失敗モード・負の証拠 |
|---|---|---|---|
| llama-server README(一次) | routerモードCLI | `--models-max`既定4、`--sleep-idle-seconds`既定-1(無効) | `/metrics`はrouterモードで`?model=`必須(400エラー) |
| README「Sleeping on Idle」 | アイドル解放 | `/health`/`/props`/`/models`/`/metrics`がタイマー除外 | 同機構への不具合報告(#23096)がclosed not plannedで残存、記述と食い違う可能性 |
| Issue #19379 | GPU解放 | 約600MiB/idleサブプロセスが未解放 | closed as not planned、恒久リスク |
| Issue #18189 | 機能要求 | — | closed as not plannedだが後にPR #18228で別名実装 |
| AUR RPC API(一次) | `llama.cpp-cuda-git` | 6票、2026-01作成、2026-09-14更新 | 無印`llama.cpp-cuda`は現存せず、`extra`リポジトリも0件 |
| nix-community/discourse | CUDAバイナリキャッシュ | unstable-smallのみ | 「stableブランチ向けの新規公開キャッシュは無い」というコメント |
| GitHub Releases API(一次) | Linux CUDAバイナリ | nightly(prerelease)は継続配布、`v0.5.0`安定版タグは`nightly-tag.txt`のみ | 安定版タグに実体バイナリが付かない理由は未確認 |
| discourse #60557 | home-manager standalone + GPU | — | 実践者が「struggling」と明言、3対策とも確定解決に至らず |
| nijho.lt | NixOS本体でのCUDAビルド | 8→50 tok/s(フラグ調整効果) | NixOS本体前提、standalone home-managerには直接適用不可 |
| highllama README | systemd --user + linger | — | GPU対応を謳うがlinger単体でのGPUアクセス検証記述はなし |

---

## 否定側の証拠(明示)

- **`--sleep-idle-seconds`はrouterモードで少なくとも2系統の未解決不具合を抱える**: `/metrics`ポーリングがタイマーをリセットしてスリープを妨げるという報告(#23096)と、スリープ後もサブプロセスがGPUメモリを約600MiB保持し続けるという報告(#19379)——**両方ともclosed as not plannedのまま残っており、「アイドルで自動的にGPUを解放する」という前提を額面通りには置けない**。
- **README原文に「LRU」という語自体は存在しない**——`--models-max`到達時の挙動の評価基準(「least-recently-used」)はHugging Faceブログという二次情報に依存しており、一次原文では単に「maximum number of models to load simultaneously」としか書かれていない。
- **無印AUR `llama.cpp-cuda`は現存しない**——現行の代替`llama.cpp-cuda-git`は投票6・運用9か月弱の新しいパッケージで、Arch公式`extra`リポジトリには一切無い。
- **nixpkgs CUDAキャッシュはstableチャンネルを公式にはカバーしない**(discourseコメント、二次情報)——flakeがstableをpinするならソースビルドの負荷を受け入れる必要がある。
- **home-manager standalone + non-NixOS + GPUドライバの組み合わせは、実践者コミュニティでも未解決な摩擦として扱われている**(discourse #60557、確定した解決策なし)——NixOS本体でのCUDAビルド成功例(nijho.lt)はそのままOmarchyには転用できない。
- **公式GitHub Releasesの「安定版」タグにはバイナリが付かず、日次nightlyだけが実体を持つ**——コミュニティ側の「公式はLinux CUDAバイナリを出していない」という説明(WebSearchスニペット由来)は、今回のAPI直接確認と矛盾しており、この矛盾自体の理由は未検証。

---

## 確認できなかったこと(前例なし・未検証)

- 3090 Ti個体・Omarchy(Arch、standalone home-manager)でnixpkgs `cudaSupport=true`のllama-cppを実際に動かした一次報告
- `loginctl enable-linger`で起動したsystemd --userサービスが実機でGPU(nvidia-smi等)にアクセスできることを検証した一次報告
- README「/metricsはアイドルタイマー除外」という現行記述と、Issue #23096(「/metricsがタイマーをリセットする」)の食い違いがいつ・どのように解消された(またはされていない)のかの経緯
- `--models-max`到達時アンロードが本当にLRU基準であることの一次README原文の該当箇所(現状はHugging Faceブログという二次情報のみ)
- nix-community/cuda-maintainersキャッシュのstableチャンネル対応に関する一次発表ページ(discourseの後続コメントという二次情報止まり)
- 公式GitHub Releasesの「安定版タグにバイナリが付かずnightlyだけが実体を持つ」という配布方針の一次説明(リリースプロセスのドキュメント等)

---

## 結論(平易な言葉で)

**問い1(routerモードの現行CLI)**: README一次情報で骨格は確定している——`llama-server`をモデル未指定で起動、`--models-dir`/`--models-preset`/キャッシュの3系統からモデルを見つけ、OpenAI互換の`model`フィールドで選択する。`--models-max`(既定4)を超えると自動アンロードが働くが、README原文に「LRU」という語は無く、評価基準の正確な一次記述はこの調査では見つからなかった。**アイドル解放(`--sleep-idle-seconds`)は独立機能として存在するが、少なくとも2つの未解決不具合(`/metrics`ポーリングでリセットされる疑い、GPUメモリが完全には解放されない)を抱えたままclosed as not plannedになっている**——「放っておけばVRAMが空く」という前提を無条件には置けない。`--api-key`と`--metrics`はrouterモード専用の除外は無いが、`--metrics`だけは`?model=`クエリが無いと400になるという固有の制約がある。

**問い2(CUDAバイナリの入手経路)**: 3経路とも一長一短が実証された。**nixpkgs `cudaSupport=true`はstableチャンネルの公開バイナリキャッシュが無く、standalone home-manager特有の`libcuda.so`ドライバ不一致問題(discourseスレッドで未解決のまま)も抱える**——決定記録が選んだ「standalone home-manager」という前提と、CUDAパッケージの相性は良くない可能性がある。**AURの`llama.cpp-cuda-git`は現存する唯一の選択肢だが投票6・運用9か月弱と薄く**、無印パッケージは既に消滅している。対して**公式GitHub Releasesは日次nightlyでUbuntu向けCUDAプリビルドバイナリを継続配布しており、実は最も手数が少なく検証も現行データで直接確認できた経路**——ただし「安定版」タグ自体にはバイナリが付かないため、運用するなら「常にnightlyを追う」という前提を受け入れる必要がある。この3経路のどれを取るかは、決定記録が定めた「standalone home-managerでマシン構成を管理する」という上位方針と、CUDAバイナリの入手を分離できるかどうかにかかっている——**home-managerで多くを管理しつつ、llama-server本体だけは公式nightlyバイナリを直接ダウンロードする、というハイブリッドが今回の証拠には最も整合する**が、これは推論であり[unverified]、この組み合わせを実践した一次報告は見つかっていない。

**問い3(ログイン前起動とGPU)**: `loginctl enable-linger`はsystemd --userサービスをブート時から常駐させる標準機構で、近縁ツール(highllama)がGPU対応と linger手順を並べて明記していることから、実地の先例としては成立している。ただし**3090 Ti個体・Omarchy固有でlinger環境下のGPUアクセスを直接検証した報告は見つからず**、「GPUドライバはユーザーセッションに依存しないはずだから動くだろう」という推測の域を出ない[unverified]——実機での動作確認は決定記録のConsequencesが既に「未確認」として挙げている通り、この調査でも埋まらなかった。

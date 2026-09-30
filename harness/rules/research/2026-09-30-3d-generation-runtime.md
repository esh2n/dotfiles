# 3Dモデル生成AIを複数試し・切り替えるランタイムは何が業界の実践か 調査記録

調査日: 2026-09-30

## 0. 前提（本調査では再検証しない）

- `2026-09-30-one-gpu-llm-and-3d-generation.md`: VRAM要件（Hunyuan3D-2.1 形状+テクスチャ29GB、TRELLIS.2 ≥24GB）、ComfyUIの`POST /free`によるVRAM解放API、llama-swapのComfyUI公式サポート（`comfyui_auto`予約ID、`concurrencyLimit`999への引き上げ、`ignoreWebsockets`）、llama.cppのrouter mode VRAM残留バグ（Issue #19379）は確立済み。本調査では引用のみで再検証しない。
- `2026-09-30-home-model-fleet-control.md`: GPUStackがv2.0.0でmacOSワーカーを打ち切ったこと、llama-swapが機械をまたぐ機能を持たないこと、LM Studioの`lms --host`遠隔操作口は確立済み。
- 要件: 生成した3Dアセットはゲーム内で使う（トポロジー・出力形式が実用性に直結する）。

## 1. 方法と検証の凡例

| 記号 | 意味 |
|---|---|
| [直接] | `curl`でベンダーの生ドキュメント（GitHub raw、GitHub REST/Search API）を取得し、grep・行番号で原文引用した |
| [要約経由] | `WebFetch`（AIによる要約）を通した。原文全体は見ていない |
| [到達不能] | 試みたが到達できなかった |
| [測定なし] | ソース自体に数値が無い |
| [推測/未確認] | 一次資料で裏付けが取れていない推論 |

WebSearchはこのセッション開始時点で既に予算（200/200）を使い切っており、本調査でも一度も使えなかった。代わりに `curl` + `api.github.com`（GitHub REST/Search API、認証なし・IPレート制限あり）、GitHub raw ファイル、および到達可能だった DuckDuckGo HTML検索（`html.duckduckgo.com`）経由での横断検索、個別URLへの`WebFetch`で補った。`gh`コマンドはこのサンドボックスで`api.github.com`へのTLS検証が失敗するため使用していない。

---

## 2. 結論（先出し）

### Q1: ランタイムはどれが実践水準か

**ComfyUI＋カスタムノードが唯一「複数モデルを1つのHTTP口から切り替えて試す」を実際に満たす選択肢だが、依存関係とセキュリティの代償を伴う。他の2択（各モデル公式サーバー／Pinokio等の別ホスト）はそれぞれ別の理由で本件の要件（複数候補を切り替えて試す・HTTPで駆動）を満たさない。**

- **(a) ComfyUI＋カスタムノード**: `/prompt`・`/queue`・`/history`・`/free`・WebSocketという単一のHTTP APIの上に、Hunyuan3D・TRELLIS/TRELLIS.2複数のラッパーノードをインストールして共存させられる（§3.1〜3.3）。これは「切り替えて試す」という要件に最も直接的に応える。代償は二つ、しかも両方とも一次情報で裏付けが取れている:
  1. **依存関係地獄**: 各ラッパーはCUDA/torchバージョンに合わせてコンパイル済みのカスタムホイール（`custom_rasterizer`等）を配る。kijaiのラッパーはWindows専用ホイールのみで、Linux/Docker利用者向けのIssue #175は**未解決のまま放置**されている（§3.1）。ComfyUI-3D-PackもWindows Python 3.12 + CUDA 12.4 + torch 2.5.1に固定されたプリビルドで、それ以外は手動ビルド（Visual Studio Build Tools／`gcc g++`）が要る（§3.2）。
  2. **セキュリティ**: ComfyUIのカスタムノード生態系は現在進行形でマルウェアの標的になっている。2026年9月29〜30日（調査日直前）にComfy-Org自身のIssue trackerに報告された事例では、Registryで配布中のノードパック（3,743ダウンロード、全13バージョンが報告時点でも"Active"）経由でRAT＋クリプトマイナーが9日間居座った（§4.1）。2025年10月にも盗撮型マルウェア入りパックが790ダウンロードされた事例があり（§4.2）、2026年3〜4月には1,000台超のインターネット公開ComfyUIインスタンスがボットネット化された（§4.3、ただしこちらは「インターネットに公開した」ことが主因でtailnet限定なら軽減される）。tailnetに閉じても**「悪意あるノードパックを自分でインストールしてしまう」というサプライチェーン型のリスクは軽減されない**——実際、9月の被害はローカルインストールで発生している。
- **(b) 各モデル公式サーバー**: Hunyuan3D-2.1は`api_server.py`という完成されたFastAPIサーバーを持ち、`API_DOCUMENTATION.md`に`/send`（非同期投入）＋`/status/{uid}`（ポーリング）という非同期タスクAPIが文書化されている（§3.4）——これはComfyUIのノードグラフより薄く、HTTPで叩くだけなら最も素直な形。ただし**TRELLIS/TRELLIS.2には同等のREST APIが無く、公式サーバーはGradioデモ（`app.py`の`demo.launch()`）のみ**で、host/portの明記や非同期タスクキューは無い（§3.5）。つまり「モデルごとの公式サーバーを並べる」方式は、モデルによって装備の差が大きく、TRELLIS系では結局自分でラッパーを書くかComfyUIに頼ることになる。またHunyuan3D-2.1公式Dockerは**ビルドに1時間超、イメージサイズ70GB超**（§3.4）で、複数モデルをこの形で並べるとディスク・ビルド時間のコストが線形に積み上がる。
- **(c) 他のホスト**: Pinokioは非公式のコミュニティスクリプト（`pinokiofactory`組織配下）がHunyuan3D・TRELLIS向けに存在するが、いずれもstar数20未満で採用は薄い（§3.6）。SwarmUI（4,620 star、調査当日push、非常に活発）は**自身がComfyUIをバックエンドとして自動インストールする**フロントエンドであり、3Dへの言及はREADMEに一切無い——独立した選択肢ではなくComfyUIの上位互換ではない（§3.7）。InvokeAIは画像生成専用で3Dへの言及がゼロ（§3.8）。GPUStackは自身の対応カテゴリを「LLM, voice, image, and video」と定義しており、**「3D」という区分がベンダー自身の語彙に存在しない**（§3.9、既存調査の「macOSワーカー打ち切り」と合わせて二重に不採用）。

**切り替えの実装**: ComfyUI案では複数ノードパックが同一Python環境に同居するため、パック間のtorch/CUDAバージョン競合がその都度起こり得る（kijaiは torch2.6.0+cu126固定ホイール、ComfyUI-3D-Packはtorch2.5.1+cu124固定プリビルド——**この2つを同じComfyUI環境に共存させることを想定した一次情報は見つからなかった**）。各モデル公式サーバー案では、モデルごとに独立したPython仮想環境／プロセスにできるため依存関係の分離は容易だが、切り替え自体（プロセスの起動・停止、VRAM解放の待ち合わせ）を自分で書く外側の層が要る——これは既存調査`2026-09-30-one-gpu-llm-and-3d-generation.md`が既に指摘した「llama-swapのgroups機能とComfyUIの組み合わせ設定例が無い」という空白と同じ形の空白が、モデル公式サーバー同士の切り替えにも当てはまる。

### Q2: 24GBカードで試す価値のある候補（2026-09時点）

| モデル | ライセンス | VRAM（自己申告） | テクスチャ | 出力形式 | 速度 | 保守状態 |
|---|---|---|---|---|---|---|
| Hunyuan3D-2.1 | Tencentコミュニティライセンス（月間アクティブ100万人超で要申請、EU/UK/韓国除外）[直接] | 形状10GB／テクスチャ21GB／合計29GB（24GB超過）、`--low_vram_mode`あるが数値未記載 | あり（PBR、別モデル） | GLB | 数値なし | 停滞（pushed 2025-10-17、約11.5ヶ月） |
| TRELLIS.2 | MIT（`nvdiffrast`/`nvdiffrec`サブモジュールは別ライセンス） | 24GB以上必須（＝3090 Ti全量） | あり（Pixal3D等、コミュニティラッパー経由） | GLB他 | 数値なし | 継続（pushed 2026-07-10、約3ヶ月） |
| Step1X-3D | Apache-2.0（本調査で見つけた中で最も緩い） | 形状+テクスチャ 27〜29GB（自己申告の推論ベンチ表）[直接] | あり | GLB | 50ステップで152秒[直接] | 停滞（pushed 2025-09-08、約13ヶ月） |
| SPAR3D | Stability AI Community License（年商100万ドル未満は無料） | 既定10.5GB、`SPAR3D_LOW_VRAM=1`で約7GB[直接] | あり（色付きポイントから再構成） | GLB | 数値なし | 停滞（pushed 2025-05-05、約17ヶ月） |
| Stable Fast 3D | 同上Stability AI Community License | 既定6GB（最軽量）[直接] | あり | GLB | 数値なし | ほぼ停止（pushed 2025-01-22、約20ヶ月） |
| TripoSG | MIT（無制限） | 8GB以上[直接] | **なし（形状のみ、README中にtexture/color/paintの言及ゼロ）**[直接] | GLB | 数値なし | 停滞（pushed 2025-04-18、約17ヶ月） |

補足（すべて[直接]、GitHub REST API）: Hunyuan3D-2.1 stars 4,098／Step1X-3D stars 893／SPAR3D stars 1,077／TripoSG stars 1,812／TRELLIS.2 stars 11,403（既存調査より）。

**ゲーム素材としてのトポロジー**: 複数の第三者ブログ（genvr.ai、blenderloop.com、[要約経由]WebFetch）によれば、Hunyuan3Dの「高品質」プリセットは**20万ポリゴン超**の生の三角形メッシュを吐き、ゲーム用の予算は**5,000〜30,000クアッド**が目安とされる。Tencentは"PolyGen"というクアッドリトポロジー機能を持つが、これは`3d.hunyuan.tencent.com`という**ホスト型SaaSとしてのみ提供されており**、GitHub検索（`hunyuan3d-polygen`、`hunyuan3d 3.1`）では対応するオープンソースリポジトリが見つからなかった——**自前ホストするHunyuan3D-2.1にはこの機能が付いてこない**。これを埋めるために、コミュニティのComfyUIラッパー（kijai、visualbruno/ComfyUI-Trellis2）が独自の"Reconstruct Mesh with Quad"「Remesh with Quad」ノードを追加している（§3.3のchangelog内、2026-02-08〜02-17の複数エントリ）。**リトポロジーは「オープンソースの生成モデル本体」ではなく「コミュニティが後付けした周辺ツール」が担っている**、という構図。

Step1X-3Dは**Hunyuan3Dの`custom_rasterizer`と`differentiable_renderer`をそのまま再利用している**（README:113、"We reused custom_rasterizer and differentiable_renderer tools in Hunyuan3D 2.0 for the texture baker"）——ライセンスはApache-2.0で軽いが、ビルド時の依存関係はHunyuan3Dと同じ根を持つため、Hunyuan3D側で解決できない依存関係の問題（Linux/Dockerでのビルド困難、Issue #175）を引き継ぐ可能性が高い[推測/未確認、Step1X-3D側のIssueは調査していない]。

### Q3: GPUの用途切り替えをどう名付けているか

**「LLM ↔画像/3D生成」という切り替えそのものに専用の名前を与えている実践は見つからなかった。** 見つかったのは全て汎用の仕組みで、意味的な命名は各自の裁量に委ねられている:

- llama-swapの公式ドキュメント例（`groups-and-matrix.md`）は`main`（大きいLLM用、排他）、`small`（埋め込み・リランカー等、非排他）、`forever`（常駐）という**機能ベースの名前**を使っており、"llm"や"image"のような意味的な命名規則は提示していない[直接]。
- llama-swapのComfyUI公式ガイドは、ComfyUI自体を`comfyui_auto`という**予約モデルID**として扱う（既存調査で確認済み）——これは「グループ名」ではなく「1つのモデルとして扱うための特別な識別子」であり、LLMとの排他をどう名付けるかは利用者側に委ねられている。
- GPUStackはベンダー自身の語彙で対応カテゴリを「LLM, voice, image, and video models」と定義しており（README、[直接]）、**そこに"3D"という区分は無い**——3D生成はこの業界の製品カテゴリ語彙でまだ独立した扱いを得ていないことを示唆する。
- Olla（thushan/olla、311 star、[直接] pushed 2026-09-27）はモデルを横断して一覧・ルーティングするが、load/unloadやモード切り替えの機能自体を持たない（既存調査`2026-09-30-home-model-fleet-control.md`で確認済み）ため、命名の実例そのものが存在しない。
- 唯一近い実践者ガイド（Varun Vasudeva、既存調査で確認済み、838 star）はGPU 2枚構成のため「切り替え」自体を必要とせず、この種の命名は現れない。

**「前例なし」**: LLMサービングと画像/3D生成を1つのGPU上で切り替えるモード／グループに専用の意味的な名前（例えば"inference"対"generation"、"chat"対"art"のような対）を与えている公開設定例・ホームラボ記事は、本調査で到達できた範囲では見つからなかった。

---

## 3. 根拠（四方向の証拠）

### 3.1 kijai/ComfyUI-Hunyuan3DWrapper — 依存関係の実態

一次ソース: [直接] `https://raw.githubusercontent.com/kijai/ComfyUI-Hunyuan3DWrapper/main/readme.md`、GitHub Issues API。

- インストールはWindows向けにコンパイル済みホイールを配る形（readme.md:23-37）:
  > "**Windows 11 python 3.12 cu126 (works with torch build on 124)**" / "**Windows 11 python 3.12 torch 2.6.0 + cu126**"
  - Linux/Docker向けのビルド済みホイールは配布されていない。ビルドできない場合は`hy3dgen/texgen/custom_rasterizer`で`python setup.py install`を自分で実行する必要がある（readme.md:44-48）。
- xatlasのアップグレード手順は、ソースコードを手で編集する指示を含む（readme.md:100-119）:
  > "in `xatlas-python\extern\xatlas\source\xatlas` modify `xatlas.cpp` / change line 6774: `#if 0` to `//#if 0` / change line 6778: `#endif` to `//#endif`"
- **Issue #175「Linux-compatible .whl or build instructions for Docker/Linux users」**（[直接] `https://api.github.com/repos/kijai/ComfyUI-Hunyuan3DWrapper/issues/175`、open）:
  > "The custom_rasterizer wheel in the repo appears to be compiled for Windows (win_amd64), and can't be installed inside the container (.whl is not a supported wheel on this platform)... there's no Linux-compatible .whl, and no setup.py or CMake file to build it from source."
  - 唯一のコメントは「蹲」（意味のある返答ではない）——**未解決のまま放置**。
- **Issue #214「No module named 'custom_rasterizer' on RTX 5060 Ti (Blackwell, sm_120)」**（open, [直接]タイトルのみ）と**Issue #201（Windows ROCm/RDNA4でも同種のエラー）**——新しいGPUアーキテクチャがプリビルドホイールの対象外になっている、という継続的な摩擦。
- **Issue #165「2.1 pbr material low vram support」**（open, [直接]本文・コメント取得）——コメントで提示された回避策はComfyUIの外（`mmgp`パッケージによるオフロード）で動かすコード例であり、コメント主（zwukong）は「Run locally，not in comfyui」（ComfyUIの中ではなくローカルで動かしている）と回答している——**ComfyUIラッパー自体の中でPBRテクスチャ生成の低VRAM化が解決していない**ことを示す一次的な否定的証拠。
- stars 1,043、`pushed_at: 2026-03-16`（[直接] API）。

### 3.2 MrForExample/ComfyUI-3D-Pack — プリビルドの固定バージョン

一次ソース: [直接] `https://raw.githubusercontent.com/MrForExample/ComfyUI-3D-Pack/main/README.md`。

> "Pre-builds are available for: Windows 10/11, Python 3.12, CUDA 12.4, torch 2.5.1+cu124" / "install.py will download & install Pre-builds automatically according to your runtime environment, if it couldn't find corresponding Pre-builds, then build script will start automatically" / "you'll still need to install Visual Studio Build Tools for windows and install gcc g++ for Linux in order for InstantNGP & Convert 3DGS to Mesh with NeRF and Marching_Cubes nodes to work"

stars 3,879、`pushed_at: 2025-12-29`（約9ヶ月前、[直接] API）。Docker手順（`DOCKER_INSTRUCTIONS.md`）も存在するが本調査では中身を未確認[到達不能/未実施]。

### 3.3 TRELLIS.2向けComfyUIラッパー群 — 最も活発、機能追加が速い

一次ソース: [直接] GitHub Search API、`https://raw.githubusercontent.com/visualbruno/ComfyUI-Trellis2/main/README.md`。

複数の独立したラッパーが並立している（[直接] `gh api search/repositories?q=trellis+comfyui`）:

| リポジトリ | stars | 最終push |
|---|---|---|
| visualbruno/ComfyUI-Trellis2 | 847 | 2026-09-25（5日前） |
| PozzettiAndrea/ComfyUI-TRELLIS2 | 576 | 2026-08-24 |
| if-ai/ComfyUI-IF_Trellis | 454 | 2025-03-09（旧TRELLIS向け） |
| smthemex/ComfyUI_TRELLIS | 182 | 2025-08-17 |

visualbruno版は2026-01から2026-09まで**毎週近い頻度**で機能追加が続いている——例えば"Reconstruct Mesh with Quad"ノード（2026-02-17追加、README changelog）、"Mesh Texturing Pixal3D MultiView"（2026-09-08追加）。要件面では`facebook/dinov3-vitl16-pretrain-lvd1689m`モデルへのアクセスが必須、`TencentARC/Pixal3D-T`モデルを使うには追加で`natten`パッケージのインストールが要る、と明記されている——**TRELLIS.2本体だけでなく、ラッパーが機能ごとに別の重い依存を積み増していく**構造。

### 3.4 Hunyuan3D-2.1 公式サーバー — REST APIは薄いが、Dockerは重い

一次ソース: [直接] `API_DOCUMENTATION.md`、`api_server.py`、`docker/Dockerfile`、`docker/README.md`（すべてGitHub raw）。

- `api_server.py:196-205`（argparse抜粋）:
  ```
  --host, default="0.0.0.0"
  --port, default=8081
  --model_path, default='tencent/Hunyuan3D-2.1'
  --device, default="cuda"
  --limit-model-concurrency, default=5
  --enable_flashvdm (フラグ)
  --compile (フラグ)
  ```
- `API_DOCUMENTATION.md`が記述するエンドポイント: `POST /generate`（同期）、`POST /send`＋`GET /status/{uid}`（非同期タスクキュー）、`GET /health`。Swagger UI (`/docs`) とReDoc (`/redoc`) 付き。**認証は「currently not required」と明記**——tailnet限定での運用が前提になる。
- Docker（`docker/README.md`）:
  > "This docker setup is tested on Windows 10." / "the total built time might take more than one hour." / "the total size of the built image will be more than 70GB."
- ローカルビルドでも`custom_rasterizer`のpipインストールと`compile_mesh_painter.sh`の実行が必須（README.md:98-102）——**ComfyUIラッパーと同根の依存関係の重さが、公式サーバーを直接使う場合にも残る**（ComfyUI固有の問題ではない）。
- README冒頭のリンクにゲームエンジン向け統合の第三者実装がある（README:41）: "Hunyuan3d-2-1 Unity Support: https://github.com/VR-Jobs/Hunyuan3D-2.1-Unity-XR-PC-Phone" ——ゲーム開発向けの統合実績が非公式ながら存在する。

### 3.5 TRELLIS/TRELLIS.2 公式サーバー — Gradioのみ、REST APIなし

一次ソース: [直接] `https://api.github.com/repos/microsoft/TRELLIS.2/contents/`、`https://raw.githubusercontent.com/microsoft/TRELLIS.2/main/app.py`。

- リポジトリ直下には`app.py`と`app_texturing.py`のみ（`api_server.py`に相当するものは無い）。
- `app.py`を`gradio|fastapi|launch|server_name|server_port`でgrepすると、ヒットするのは`import gradio as gr`と`demo.launch(css=css, head=head)`のみ（[直接]、行1・617・645）——**host/portの明示的な設定もREST的な非同期タスクAPIも無い**。HTTPで自動化して叩くには、Gradioクライアント（`gradio_client`）経由か、自分でFastAPIラッパーを書く必要がある。
- `setup.sh`は`--flash-attn`、`--cumesh`、`--o-voxel`、`--flexgemm`、`--nvdiffrast`、`--nvdiffrec`という個別のオプショナルビルドフラグを持つ（[直接] raw取得）——**公式インストーラ自体が、コンポーネントごとに別々のCUDA拡張ビルドを要求する構造**であることを示す。

### 3.6 Pinokio — 非公式スクリプト、低採用

一次ソース: [直接] GitHub Search API（`org:pinokiofactory`）。

| リポジトリ | stars | 最終push |
|---|---|---|
| pinokiofactory/Hunyuan3d-2-lowvram | 22 | 2026-08-13 |
| pinokiofactory/TRELLIS | 19 | 2025-06-08 |
| pinokiofactory/Hunyuan3D-2 | 12 | 2025-11-09 |
| Deathdadev/TRELLIS.2-Pinokio（非公式・pinokiofactory外） | 5 | 2026-07-21 |
| pinokiofactory/Hunyuan3D-2-mini | 0 | 2025-01-25 |

いずれもComfyUIラッパー（§3.1〜3.3、最大1,043 star）やTencent本体のリポジトリ（4,098〜14,994 star）と比べて一桁〜二桁小さい採用規模。

### 3.7 SwarmUI — ComfyUIを内包するフロントエンドであり、独立候補ではない

一次ソース: [直接] `https://raw.githubusercontent.com/mcmonkeyprojects/SwarmUI/master/README.md`、GitHub API。

> "has the ability to auto-install ComfyUI (GPL)." / "has the option to use as a backend AUTOMATIC1111/stable-diffusion-webui (AGPL)."

stars 4,620、`pushed_at: 2026-09-30`（調査当日、[直接]）——非常に活発だが、README全文を`3d|mesh|hunyuan|trellis`でgrepしても0件ヒット。**SwarmUIはComfyUIをバックエンドとして自動導入する画像生成フロントエンドであり、3D生成機能そのものは持たない**——「別ホスト」の選択肢としては成立しない。

### 3.8 InvokeAI — 3D非対応

一次ソース: [直接] `https://api.github.com/repos/invoke-ai/InvokeAI`、README raw。

説明文: "Invoke is a leading creative engine for Stable Diffusion models..." README全文を`3d|mesh`でgrepしても0件。画像生成専用であり本件の候補にならない。

### 3.9 GPUStack — ベンダー自身の語彙に「3D」区分が無い

一次ソース: [直接] `https://raw.githubusercontent.com/gpustack/gpustack/main/README.md`（既存調査`2026-09-30-home-model-fleet-control.md`のmacOSワーカー打ち切りの節と同一ソース、本調査ではカテゴリ語彙のみ追加確認）。

> "It supports industry-standard APIs for LLM, voice, image, and video models."

「LLM・音声・画像・動画」の4区分のみで、3Dへの言及はREADME中に無い。既存調査で確認済みの「v2.0.0でmacOSワーカーを打ち切った」という事実と合わせ、GPUStackは本件の両方の軸（マルチプラットフォーム、3D生成）で不適合。

---

## 4. 測定された証拠（measured evidence）— セキュリティを中心に

課題追跡・セキュリティ速報は否定的な報告に偏る、という性質を踏まえて読むこと。以下はすべてComfyUIのカスタムノード生態系に関するもので、3D生成AI各モデル自体の生成品質ベンチマークは本調査でも見つからなかった（§7参照）。

### 4.1 Comfy-Org/ComfyUI Issue #16631（open、2026-09-29〜30、調査日直前）

[直接] `https://api.github.com/repos/Comfy-Org/ComfyUI/issues/16631`。

> "A Windows ComfyUI Desktop user installed **champdev-comfyui-nodes v0.5.2** from the Comfy Registry via ComfyUI-Manager (`install_method: cnr`). The machine ended up compromised with a full-featured **RAT (remote access trojan) and a cryptominer**, which persisted for at least 9 days. The pack has **3,743 downloads** and all 13 of its versions (0.1.0–0.6.1) are still Active on the Registry, so other users are likely affected."

タイムライン抜粋:
> "2026-09-20 09:37:36 | Unsigned 18 MB miner (`comfyui.exe`) appears in the ComfyUI shared output directory, connecting to `prl.kryptex.network:7048`" / "2026-09-23 → 09-29 | A RAT is deployed locally... plus 7 fake node packs... are created in `custom_nodes`" / "2026-09-29 | At IR time, **~60 hidden python processes** were running the C2 client"

このインシデントは**インターネットへの公開の有無に関係なく、ノードパックをインストールした時点で成立している**（Windows ComfyUI Desktopのローカルインストール）。tailnet限定運用ではこの種のサプライチェーン型リスクは軽減されない。

### 4.2 blog.comfy.org「Upscaler-4K」インシデント（2025-10、[要約経由]）

[要約経由] `https://blog.comfy.org/p/upscaler-4k-malicious-node-pack-post`。

- 2025-10-17〜19にユーザー"lonemilk"が`lonemilk-upscalernew-4k`・`upscaler-4k`という2つの悪意あるノードパックをComfy Registryに公開、Akira Stealerというマルウェアを含んでいた。
- 2025-10-21 17:00 PSTに内部スキャナが検知、同日中にRegistryメンテナ（Dr.Lt.Data）が確認しBan——**公開からBanまで4日**。
- "Before the ban was implemented, these nodes were downloaded a total of **790 times**." ——コメント欄では、Ban後もManager経由でインストール可能な状態が残っていた、という指摘があったと要約されている（[要約経由]、原文コメントは未確認）。

### 4.3 thehackernews.com「1,000台超のComfyUIインスタンス」ボットネット化（2026-03〜04、[要約経由]）

[要約経由] `https://thehackernews.com/2026/04/over-1000-exposed-comfyui-instances.html`。

> "there are more than 1,000 publicly-accessible ComfyUI instances" — 攻撃者は認証なしで生のPythonコードを受け付け実行してしまう既存のカスタムノード（`ComfyUI-Shell-Executor`、`ComfyUI_Fill-Nodes`、`srl-nodes`、`ComfyUI-RuiquNodes`）を悪用、無ければComfyUI-Managerの有無を確認して自ら悪性ノードパックを投入する。

この経路は「インターネットに直接公開している」ことが前提であり、tailnet限定（本件の既存決定）であればこの特定のベクトルは大きく軽減される。ただし§4.1のようにローカルインストール経由のリスクは別軸で残る。

### 4.4 ComfyUI-Managerのセキュリティ設定（緩和策、ベンダー製）

[直接] `https://raw.githubusercontent.com/Ltdrdata/ComfyUI-Manager/main/README.md`。

> "security_level = <Set the security level => strong|normal|normal-|weak>" / "network_mode = <Set the network mode => public|private|offline>"

`security_level`はノードのインストール可否をゲートする設定として存在する（README:275以降）が、既にインストール済みの悪意あるパック自体を検知する機能ではない——§4.1の被害は`install_method: cnr`（Registry経由の正規インストール手順）で発生しており、`security_level`のゲートを通過した後の話である。

---

## 5. 比較表

| ソース | 種別 | 対象 | 結果・数値 | ライセンス/コスト | 既知の失敗モード |
|---|---|---|---|---|---|
| kijai/ComfyUI-Hunyuan3DWrapper readme.md | ベンダー[直接] | ComfyUIラッパー | Windows専用プリビルドホイール | MIT系（要確認） | Issue #175: Linux/Docker向けビルド手順なし、未解決放置 |
| kijai Issue #165/#214/#201 | 測定[直接] | 低VRAM・新GPU対応 | 「ComfyUIの外でrun locally」が回避策、新GPU(sm_120)は非対応 | — | open、複数未解決 |
| MrForExample/ComfyUI-3D-Pack README | ベンダー[直接] | ComfyUIラッパー | プリビルドはWin+Python3.12+CUDA12.4+torch2.5.1固定 | 要確認 | Visual Studio/gcc g++の手動ビルドが必要な場合あり |
| visualbruno/ComfyUI-Trellis2 README | ベンダー[直接] | ComfyUIラッパー | 週次に近い頻度で機能追加、847 star | 要確認 | facebook/dinov3・natten等の追加依存が機能ごとに増える |
| Hunyuan3D-2.1 API_DOCUMENTATION.md/api_server.py | ベンダー[直接] | 公式サーバー | `/send`+`/status/{uid}`非同期API、`0.0.0.0:8081` | Tencentコミュニティライセンス（MAU>100万で要申請） | 認証なし（tailnet前提）、Docker>70GB・ビルド>1時間 |
| TRELLIS.2 app.py | ベンダー[直接] | 公式サーバー | Gradioのみ、REST/非同期API無し | MIT（サブモジュール別） | 自動化にはGradio Client自作かComfyUI併用が必要 |
| Step1X-3D README | ベンダー[直接] | 推論ベンチ表 | 27〜29GB、152秒/50ステップ | Apache-2.0（最も緩い） | Hunyuan3Dのcustom_rasterizerを再利用（同根の依存） |
| SPAR3D README | ベンダー[直接] | VRAM | 既定10.5GB、低VRAMモードで約7GB | Stability AI Community（年商$1M未満無料） | 17ヶ月停滞 |
| TripoSG README | ベンダー[直接] | VRAM・機能 | 8GB以上、**テクスチャ生成なし** | MIT | 17ヶ月停滞、形状のみで別途テクスチャ工程が必要 |
| Comfy-Org Issue #16631 | 測定/実態[直接] | ノードパックのマルウェア | RAT+マイナー、3,743DL、全13バージョンActive継続 | — | 2026-09-29開設、調査日時点でopen |
| blog.comfy.org Upscaler-4K | 測定[要約経由] | ノードパックのマルウェア | Akira Stealer、790DL、Ban まで4日 | — | Ban後もManager経由インストール可という指摘あり |
| thehackernews.com | 実態[要約経由] | 公開ComfyUIの悪用 | 1,000台超が標的、無認証RCE | — | 対策はネットワーク隔離（tailnet限定で軽減） |
| genvr.ai/blenderloop.com | 実践者[要約経由] | トポロジー品質 | 高品質プリセットで20万ポリゴン超、ゲーム予算5,000〜30,000クアッド | — | PolyGenはTencentホスト型SaaSのみ、OSS版に無し |
| GPUStack README | ベンダー[直接] | カテゴリ語彙 | "LLM, voice, image, and video" | — | 「3D」の区分が存在しない |
| SwarmUI README | ベンダー[直接] | バックエンド構成 | ComfyUIを自動インストールして使う | GPL/AGPL混在 | 独自の3D機能なし |
| Pinokio (pinokiofactory) | 実態[直接] | 採用規模 | 最大22 star | — | いずれも低採用 |

---

## 6. 何が言えて、何が言えないか

**言えること（証拠のある事実）:**
- ComfyUIは「複数の3D生成モデルを1つのHTTP口の下に並べて切り替えて試す」という要件を満たす唯一の実践的な選択肢である。これは公式のVRAM解放API（既存調査）とアクティブなカスタムノードエコシステム（kijai 1,043 star、TRELLIS2系複数、直近も更新継続）の組み合わせで裏付けられる。
- その代償は一次情報で二重に裏付けられている: (1) Windows/CUDA/torchバージョンに固定されたコンパイル済み依存が、Linux/Dockerや新しいGPU世代で壊れる（kijai Issue #175, #214）。(2) ComfyUIのカスタムノード生態系は現在進行形（調査日直前の2026-09-29〜30）でマルウェアの実被害が報告されている。
- Hunyuan3D-2.1は自前のREST APIサーバーを持つ数少ないモデルで、非同期タスクキューまで文書化されている。一方TRELLIS/TRELLIS.2にはこれが無く、GradioデモかComfyUI経由でしかHTTPから駆動できない。
- ゲーム素材として見た場合、オープンソースで自前ホストできるHunyuan3D-2.1の生出力はゲーム向け予算を大きく超えるポリゴン数になり、公式のクアッドリトポロジー機能（PolyGen）はTencentのホスト型SaaSとしてのみ提供され、OSS版には無い。
- SwarmUI・InvokeAI・GPUStack・Pinokioはいずれも「複数の3D生成モデルを切り替えて試す」という要件を、それぞれ異なる理由（3D非対応、カテゴリ語彙に3Dが無い、採用が薄い）で満たさない。

**言えないこと・裏付けが弱いこと:**
- ComfyUIの1つのPython環境に、torch/CUDAバージョンが異なる複数の3Dラッパー（例: kijaiのtorch2.6.0+cu126固定ホイールとComfyUI-3D-Packのtorch2.5.1+cu124固定プリビルド）を共存させた実例は見つからなかった——「複数モデルを同一ComfyUI環境で切り替える」という具体的な運用のバージョン競合リスクは、理論的な推論であり実測ではない。
- ComfyUI旧版（Hunyuan3D-2、非2.1）の低いVRAM数値（trify3d.comが挙げる「完全パイプラインで約12GB」）は[要約経由]かつ出典が二次記事であり、Hunyuan3D-2.1本体の公式29GBという数値と直接比較できるか未確認——モデルバージョンが違う可能性が高く、鵜呑みにできない。
- Step1X-3DがHunyuan3Dの依存関係の問題（Linux/Docker向けビルドの困難）を実際に引き継いでいるかは、Step1X-3D自身のIssueトラッカーを調査していないため未確認。

**欠けているもの:**
- 3D生成AI各モデル同士の生成品質・速度を横並びで比較した第三者ベンチマーク・リーダーボード（既存調査`2026-09-30-one-gpu-llm-and-3d-generation.md`でも同じ欠落が指摘済み）。
- 「1枚の24GBカードでComfyUIを使い、複数の3D生成候補モデルを実際に切り替えて試した」という一人称の実践報告（Reddit r/comfyui・r/StableDiffusionに到達できなかったため、存在するかどうか自体が未確認）。
- ComfyUIカスタムノードのマルウェア事例が、tailnet限定・単一利用者という本件の運用形態でどの程度のリスクとして残るかを定量化した第三者評価。

---

## 7. 「前例なし」リスト（no precedent found）

- 24GB級の単一GPU上で、torch/CUDAバージョンが異なる複数の3D生成ComfyUIラッパー（Hunyuan3D系・TRELLIS系）を同一Python環境に共存させ、依存関係の衝突なく切り替えて使っている公開設定例。
- LLMサービング（llama-server/llama-swap）と3D生成（ComfyUIまたは各モデル公式サーバー）を、モデル公式サーバー方式（ComfyUIを使わない案）で切り替え運用している公開の実践報告。
- 3D生成AI各モデル（Hunyuan3D-2.1/TRELLIS.2/Step1X-3D/SPAR3D/TripoSG）の生成品質・トポロジー・速度を横並びで比較した第三者ベンチマークやリーダーボード。
- GPUの用途を「LLM」と「画像/3D生成」で切り替えるモード・グループに専用の意味的な名前（"inference"/"generation"のような対）を与えている公開のホームラボ記事・設定例。
- Reddit（r/comfyui、r/StableDiffusion、r/LocalLLaMA）における、本件そのもの（1枚のGPU・複数3D候補モデルの切り替え・ゲーム素材用途）の議論（本セッションではRedditに到達不能だったため、存在するかどうか自体が未確認）。

---

## 出典一覧

- kijai/ComfyUI-Hunyuan3DWrapper README: https://raw.githubusercontent.com/kijai/ComfyUI-Hunyuan3DWrapper/main/readme.md
- kijai/ComfyUI-Hunyuan3DWrapper Issue #175: https://github.com/kijai/ComfyUI-Hunyuan3DWrapper/issues/175
- kijai/ComfyUI-Hunyuan3DWrapper Issue #165: https://github.com/kijai/ComfyUI-Hunyuan3DWrapper/issues/165
- kijai/ComfyUI-Hunyuan3DWrapper Issue #214 / #201: https://github.com/kijai/ComfyUI-Hunyuan3DWrapper/issues
- MrForExample/ComfyUI-3D-Pack README: https://raw.githubusercontent.com/MrForExample/ComfyUI-3D-Pack/main/README.md
- visualbruno/ComfyUI-Trellis2 README: https://raw.githubusercontent.com/visualbruno/ComfyUI-Trellis2/main/README.md
- Tencent-Hunyuan/Hunyuan3D-2.1 README / API_DOCUMENTATION.md / api_server.py / docker/README.md: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
- microsoft/TRELLIS.2 app.py / setup.sh: https://github.com/microsoft/TRELLIS.2
- stepfun-ai/Step1X-3D README: https://raw.githubusercontent.com/stepfun-ai/Step1X-3D/main/README.md
- Stability-AI/stable-point-aware-3d README / LICENSE.md: https://github.com/Stability-AI/stable-point-aware-3d
- VAST-AI-Research/TripoSG README: https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/README.md
- pinokiofactory 各リポジトリ: https://github.com/pinokiofactory
- mcmonkeyprojects/SwarmUI README: https://raw.githubusercontent.com/mcmonkeyprojects/SwarmUI/master/README.md
- invoke-ai/InvokeAI README: https://github.com/invoke-ai/InvokeAI
- gpustack/gpustack README: https://raw.githubusercontent.com/gpustack/gpustack/main/README.md
- mostlygeek/llama-swap groups-and-matrix.md: https://raw.githubusercontent.com/mostlygeek/llama-swap/main/docs/kb/guides/routing/groups-and-matrix.md
- thushan/olla: https://github.com/thushan/olla
- Comfy-Org/ComfyUI Issue #16631: https://github.com/Comfy-Org/ComfyUI/issues/16631
- blog.comfy.org（Upscaler-4Kインシデント、[要約経由]）: https://blog.comfy.org/p/upscaler-4k-malicious-node-pack-post
- thehackernews.com（1,000台超のComfyUI露出、[要約経由]）: https://thehackernews.com/2026/04/over-1000-exposed-comfyui-instances.html
- Ltdrdata/ComfyUI-Manager README: https://raw.githubusercontent.com/Ltdrdata/ComfyUI-Manager/main/README.md
- elekibear.com（Plasmo、[要約経由]＋部分[直接]、TOC構造のみ確認）: https://elekibear.com/en/post/20260809_01_comfyui_hunyuan
- trify3d.com（[要約経由]、旧Hunyuan3D-2のVRAM数値、Hunyuan3D-2.1とは別バージョンの可能性あり）: https://trify3d.com/blog/how-to-use-hunyuan-3d-comfyui
- genvr.ai / blenderloop.com（[要約経由]、トポロジー・PolyGen SaaS）: https://genvr.ai/models/3d-generation/hunyuan-3-1-3d-retopology , https://www.blenderloop.com/2025/07/hunyuan3d-polygen-ai-now-generates.html

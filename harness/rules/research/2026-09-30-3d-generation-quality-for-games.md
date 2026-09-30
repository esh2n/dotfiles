# ソロ/インディーのゲーム開発者にとって、使えるゲーム素材としての3Dモデル生成AIの「品質」はどれが上か 調査記録

調査日: 2026-09-30

## 0. 前提（本調査では再検証しない）

- `2026-09-30-3d-generation-runtime.md`: ローカル生成モデルを1つのHTTPインターフェースで切り替えて試す実践は ComfyUI＋カスタムノード以外に成立せず、依存関係とセキュリティ双方の代償がある。Hunyuan3D-2.1の生出力はゲーム予算（5,000〜30,000クアッド目安）を大きく超える20万ポリゴン超で、公式のクアッドリトポロジー機能（PolyGen）はTencentのホスト型SaaS（`3d.hunyuan.tencent.com`）としてのみ提供され、OSS版には無い。
- `2026-09-30-one-gpu-llm-and-3d-generation.md`: 各ローカルモデルのVRAM自己申告値・ライセンス・保守状態の一次情報（Hunyuan3D-2.1 形状10GB/テクスチャ21GB/合計29GB・Tencentコミュニティライセンス、TRELLIS.2 24GB以上必須・MIT、Step1X-3D 27〜29GB・Apache-2.0、SPAR3D 既定10.5GB・Stability AI Community License、Stable Fast 3D 6GB・同ライセンス、TripoSG 8GB以上・MIT・テクスチャ生成なし）は確立済み。本調査ではこれらを引用のみで再検証しない。
- 要件: ゲームで実際に使える素材としての「品質」＝プロンプト/画像への忠実度、クリーンなトポロジー・妥当なポリゴン数（リトポロジー/クアッドリメッシュ、LOD）、UV展開、PBRテクスチャ（albedo/normal/roughness/metallic）、リギング/アニメーション対応、出力形式（GLB/FBX/USDZ）とエンジンインポート（Unity/Unreal/Godot）、複数アセット間のスタイル一貫性、アセット1個あたりの所要時間、アセットあたりのコスト/サブスクリプション、商用ゲームでの出力物のライセンス/所有権、API的な使い勝手（非同期タスクAPI、レート制限）。

## 1. 方法と検証の凡例

| 記号 | 意味 |
|---|---|
| [直接] | `curl`でベンダーの生ドキュメント・GitHub raw・GitHub REST/Search API・arXiv・Hugging Face APIを直接取得し、grep・行番号・JSONパースで原文を確認した |
| [直接/wayback] | ベンダーサイトがサンドボックスから直接到達不能、またはJSレンダリングで空だったため、`web.archive.org`のスナップショットを`curl`で取得し原文を確認した（一次情報のミラーとして扱うが、取得日と対象日にズレがある） |
| [要約経由] | `WebFetch`（AIによる要約）を通した。原文全体は見ていない |
| [到達不能] | 試みたが到達できなかった（DNS不通、JS空シェル、403など） |
| [測定なし] | ソース自体に数値が無い |
| [AI著者/要注意] | 執筆者自身が「AIが執筆した」と明記している、または明記に近い自己紹介をしている記事。実践者の一次体験としては扱わない |

WebSearchはこのセッション開始時点で予算（200/200）を使い切っており、一度も使えなかった。`gh`コマンドはこのサンドボックスで`api.github.com`へのTLS検証が失敗するため使用せず、`curl` + `api.github.com`で代替した。Redditは`www.reddit.com`・`*.reddit.com`のJSON APIともに403で到達不能（既存調査と同じ制約）。`csm.ai`は本セッションのDNSで不通だったため、`web.archive.org`のスナップショットで代替した（2026-01時点でサイトは存在しており、ベンダーが消えたわけではない）。

---

## 2. 結論（先出し）

### 中心的な発見: 「品質」の定義がずれている——3D Arenaの人気投票と、ゲーム制作が求める品質は逆を向くことがある

Hugging Face上の3D生成人気投票プラットフォーム「3D Arena」（dylanebert主催、123,243票・8,096ユーザー・19モデル、[3D Arena論文](https://arxiv.org/abs/2506.18787) [直接]）は、本調査で見つかった唯一の大規模・定量的な人気評価である。しかし論文自身が次を明言している:

> "Gaussian splat outputs achiev[e] a 16.6 ELO advantage over meshes and textured models receiv[e] a 144.1 ELO advantage over untextured models." [直接、論文Abstract]

> "voting patterns systematically favor visual impact through vibrant rendering and aesthetic appeal over downstream utility" [直接、論文5節]

そして、明示的にトポロジー品質を最優先した唯一の参加モデル「IM-MA」（InstantMesh生成＋MeshAnythingでクアッドリトポロジー、topology-aware）が**19モデル中最下位**（Elo 1016、勝率19.2%）だった（Table 1、[直接]）。つまり**このリーダーボードの順位をそのまま「ゲーム素材としての品質」の代理指標として読むことはできない**——人間の投票は見た目の第一印象（スプラットのライティング、テクスチャの有無）に偏り、クリーンなトポロジーはむしろ低いEloと相関している。論文自身が「今後の課題」として、ワイヤーフレーム表示だけを見せて投票させる別建ての"topology ELO"の必要性を提言している（5節）が、これは未実装であり、2026-09-30時点で「ゲーム素材向けに特化した定量的な品質リーダーボード」は存在しない。

### ランク付け（証拠の強さ別）

**A. 測定に最も近い証拠（3D Arena、ただし上記の限界つき）** — 2025-05-30時点のスナップショット([直接]、論文Table 1)でのみ、次の一般公開3D生成手法・商用API群が並んで比較されている: CSM/Cube（1位, Elo 1405, splat）、TRELLIS-3DGS（2位, 1384, splat）、TRELLIS（5位, 1306, mesh）、Hunyuan3D-2（7位, 1298, mesh）、InstantMesh（8位, 1278）、**Meshy**（9位, 1243, 勝率58.1%, mesh）、Unique3D（10位, 1230）、Hi3DGen（11位, 1207）、SF3D＝Stable Fast 3D（13位, 1190）、SPAR3D（15位, 1144）、LGM（16位, 1100, splat）、**TripoSR**（17位, 1089）、IM-MA（18位, 1016, リトポロジー志向で唯一かつ最下位）、3DTopia-XL（19位, 1000）。**Tripo（商用API）、Rodin/Hyper3D、Luma Genie、Sloyd、Kaedim、Backflip、Stability自身のホスト型API、Hunyuan3D-2.1・3.x（PolyGen）はこのリーダーボードに一度も登場しない**——それぞれ別の理由（後述）で比較の外にある。データセットの`outputs/`ディレクトリ一覧（[直接] HF Datasets API）を見ると、2026-09-11時点でもMeshy-5/6/7・Hunyuan3D-2.1・TRELLIS.2-4B・Pixal3D等が追加投入されているため運用は継続しているが、フロントエンドの実バックエンド（`3d-arena-3d-arena-backend.hf.space`）は本調査時点で404、論文中の`config.ts`のフォールバックURLも同様に到達不能で、**現在の（2026-09時点の）Elo順位は本調査では取得できなかった**——2025-05-30のスナップショットより新しい定量順位は存在を確認できない。

**B. ベンダー機能としては、Meshy・CSM・Rodin/Hyper3Dの3社が「ゲームエンジンへの持ち込み」を明示的な一次機能として作り込んでいる**。3社とも: (1) リメッシュ/リトポロジー機能を持つ（Meshyの`Remesh`API、CSMの"AI Retopology (Swift)"、Rodinの"Mesh Editor"）、(2) PBRテクスチャを標準出力する、(3) GLB/FBX/OBJの複数形式を出力し、Rodinは"FBX for game engines"と明記する（[直接] hyper3d.aiのFAQ）、(4) Unity/Unreal（RodinはGodotも）向けの公式プラグインを持つ、(5) 自動リギング機能を持つ（MeshyのAuto-Rigging、CSMの自動リギング、Tripoの"One-shot model animation (auto rig + retarget)"）。**この5点セットを全部満たすオープンソースのローカルモデルは本調査（および前2件の既存調査）で見つかっていない**——ローカルモデルはリトポロジーもリギングも「コミュニティが後付けしたComfyUIノード」に依存する、という既存調査の結論と対をなす。

**C. Tripoは商用APIとして機能は充実しているが、"Free"プランは非商用限定**。公式Python SDK README（[直接/wayback]）は「Mesh editing including mesh segmentation, mesh completion and smart lowpoly」「One-shot model animation (auto rig + retarget)」「External model import (GLB/OBJ/FBX/STL)」を掲げる。しかし価格ページ（[直接/wayback]、2026-09-08スナップショット）を読むと、Freeプラン（200クレジット/月、約13モデル）は明記で"Public Models · Non-Commercial Use"——インディー開発者が個人ゲームに使うだけでも実質的にPro以上（$20/月〜、月200モデル≈$0.16/モデル）が必要になる。

**D. Rodin/Hyper3Dは唯一「$1.5/クレジット」のpay-as-you-goと月額サブスクの両方を明記し、Unity/Unreal/Godot/Blender/Maya/3DS Max/ComfyUIの7プラグインを一次資料で確認できた唯一のベンダー**（[直接] hyper3d.ai価格ページ・トップページ）。1モデルあたりのコストは月額$30プランで約$0.50/モデル（30クレジット/月で約60モデル）——Tripo Pro（$0.16/モデル）やCSM Maker（$20/月・100クレジット・約$0.20/モデル）より高い。

**E. Luma Genieは2026-09-30時点で事実上の後退が確認できた**。`lumalabs.ai/genie`にアクセスすると`https://lumalabs.ai`（"AI Agents for Creative Work"）へcanonicalし、3D固有の語彙（"3D"、"genie"、"mesh"のいずれも）はトップページにもAPIページにも一切現れない（[直接]、grep 0件）。Lumaは動画生成・汎用AIエージェントへ軸足を移しており、**本調査時点で3D生成が独立した主力製品として維持されているという一次的な証拠は見つからなかった**。

**F. Kaedimは公開のセルフサーブ価格を持たない（B2B問い合わせ制）唯一のベンダーで、かつ2023年に「AIと称して実際は人間アーティストが作業していた」という報道がある**。`/pricing`ページに価格表は無く"Contact us"のみ（[直接]）。404 Mediaの報道（[直接]、2023-09-06）:

> "In reality the company, called Kaedim, uses human artists for 'quality control.' ... One of the sources said workers at one point produced the 3D design wholecloth themselves without the help of machine learning at all." [直接]

これは2023年の報道であり、2026年時点のKaedimのオペレーションを直接証明するものではない（[推測/未確認]、Kaedim側の現在のホームページは"full ownership and commercial rights"を明記しゲーム向け訴求を強めており、体制変更があった可能性はある）が、**2026-09-30時点でこの報道に対するKaedim自身または第三者による撤回・訂正記事は本調査では見つからなかった**。

**G. Backflipは比較対象から除外すべき**。ホームページの一次記述（[直接]）は「The AI copilot that CADs like a human」「Our revolutionary foundation model creates parametric 3D models with full feature trees」——メッシュをパラメトリックCAD（.STEPファイル等）へ逆変換する物理エンジニアリング向けツールであり、テキスト/画像からゲーム用メッシュを生成する製品ではない。ユーザーが列挙した候補の中で唯一「そもそもこのタスクの製品ではない」ことが一次資料で確認できたケース。

**H. Tencent Hunyuan3D 3.x / PolyGenは、Tencent自身の論文（arXiv 2509.12815「Hunyuan3D Studio: End-to-End AI Pipeline for Game-Ready 3D Asset Generation」）が存在するが、第三者による数値検証は見つからなかった**。論文Abstractは"Polygon Generation"（PolyGenに相当）と"Semantic UV"を含む一連のニューラルモジュールが「visually compelling」かつ「adhere to the stringent technical requirements of contemporary game engines」と主張するが、[直接]で確認した範囲では定量的な数値（ポリゴン削減率、UV展開の品質スコア等）は本文冒頭のAbstractに一切無い——ベンダー論文特有の宣伝的な記述に留まる。Hugging Face上でHunyuan3D-3.0という名称の公開重みは2026-09-30時点でも存在しない（[直接] HF Models API、既存調査と一致）——**この機能はオープンウェイトとして手元では検証できず、Tencentのホスト型SaaSでのみ体験できる**（既存調査を再確認）。

### 実践者の声から見える、公表機能と実運用のギャップ

- Meshy: 個人ゲーム開発者（Zenn、実名アカウントlycoris52、AI著者表記なし）の一次体験によれば、Meshyで生成したモデルはレンダリング上は問題なく見えるが、**テクスチャPNGを直接開くとUVが細かい島に分断されており、顔・服・腕の境界が視覚的にほぼ判別不能**——UnityでAI生成モデルを実際に使う場合に備え、Blenderで手動UV再展開＋テクスチャの再ベイクが必要だったと記録している（[直接]、Zenn記事全文精読）。
- Tripo: 別の実践者（Qiita、実名アカウントGingnose、AI著者表記なし）はバイクの3Dモデルをパーツ分割生成（"generate in parts"）で試し、**「quadモードだとgenerate in partsが使えないためtriangleでポリゴン数を最大化した」という具体的な機能トレードオフ**を記録し、FBXでUE5パイプラインに持ち込んだ後もスケール補正・パーツ分離・命名の手作業が残ったと述べている（[直接]、Qiita記事全文精読）。
- **日本語の実践者記事の一部はAI自身が執筆したものだった**: 「Hunyuan3Dを諦めてTRELLIS.2 4Bに乗り換えた」記事は冒頭に「この記事はAI（Antigravity/Gemini起草、Claude Code加筆）によって執筆され、Qiita APIを通じて自動投稿された」との明記があり（[直接、AI著者/要注意]）、別の「Hunyuan3D-2ライセンス誤読」記事も著者が自称「私はAI」と名乗っている（[直接、AI著者/要注意]）。**この2件は技術的な数値（頂点数比較、生成時間等）を含むが、実在の人間が実機で検証した一次体験として扱うことはできない**——日本語圏の3D生成AI「実践記」の一部はAIゴーストライティングによって汚染されている、という調査方法論上の発見そのものを記録しておく。

---

## 3. 根拠（四方向の証拠）

### 3.1 測定 — 3D Arena（Hugging Face、dylanebert）

一次ソース: [直接] `https://huggingface.co/spaces/dylanebert/3d-arena`（Space metadata API）、`https://huggingface.co/api/datasets/3d-arena/3d-arena`（Dataset API、siblings一覧）、arXiv 2506.18787 PDF全11ページ精読。

- 論文Abstract: "Since launching in June 2024, the platform has collected 123,243 votes from 8,096 users across 19 state-of-the-art models" [直接]
- Table 1（全19モデルのリーダーボード、2025-05-30スナップショット、[直接]、ページ7の画像から書き起こし）:

| Rank | Model | ELO | Votes | Win Rate | Format |
|---|---|---|---|---|---|
| 1 | CSM/Cube | 1405 | 3027 | 83.3% | Splat |
| 2 | TRELLIS-3DGS | 1384 | 3648 | 80.1% | Splat |
| 3 | Strawberrry (sic) | 1382 | 4892 | 80.9% | Mesh |
| 4 | Strawb3rry | 1370 | 5121 | 79.4% | Mesh |
| 5 | TRELLIS | 1306 | 4877 | 67.0% | Mesh |
| 6 | Zaohaowu3D | 1302 | 582 | 64.8% | Mesh |
| 7 | Hunyuan3D-2 | 1298 | 4195 | 65.5% | Mesh |
| 8 | InstantMesh | 1278 | 10575 | 63.8% | Mesh |
| 9 | Meshy | 1243 | 7023 | 58.1% | Mesh |
| 10 | Unique3D | 1230 | 8959 | 55.1% | Mesh |
| 11 | Hi3DGen | 1207 | 1565 | 47.7% | Mesh |
| 12 | MeshFormer | 1192 | 5394 | 48.6% | Mesh |
| 13 | SF3D (Stable Fast 3D) | 1190 | 6267 | 48.4% | Mesh |
| 14 | Real3D | 1158 | 8541 | 42.5% | Mesh |
| 15 | SPAR3D | 1144 | 3783 | 38.6% | Mesh |
| 16 | LGM | 1100 | 10344 | 32.7% | Splat |
| 17 | TripoSR | 1089 | 10296 | 31.4% | Mesh |
| 18 | IM-MA | 1016 | 7519 | 19.2% | Mesh |
| 19 | 3DTopia-XL | 1000 | 5425 | 15.6% | Mesh |

- 重要な限界の自己申告（論文4.3節、[直接]）:
  > "voting patterns systematically favor visual impact through vibrant rendering and aesthetic appeal over downstream utility. ... Notable exceptions exist, however, with models like Hi3DGen achieving higher ratings than multiple textured alternatives despite producing untextured meshes."
  > "IM-MA, a hybrid system combining InstantMesh generation with MeshAnything retopology... represents a topology-aware approach prioritizing mesh structure over polygon density... IM-MA's performance reflects different optimization criteria focused on mesh topology rather than visual fidelity." (4.2.3節)
- 5節の提言（[直接]）: "For topology assessment, users could be presented with only the wireframe view and polygon count information... These results could be used to calculate a separate *topology* ELO score." — **これは提言であり、2026-09-30時点で実装されたという証拠は見つからなかった**。
- データセットの現況（[直接] HF Datasets API、`lastModified: 2026-09-11T08:14:10Z`）: `outputs/`配下に29モデル分のディレクトリが存在し、論文執筆時点（2025-05-30）には無かった`Meshy-5`, `Meshy-6`, `Meshy-7`, `Hunyuan3D-2.1`, `TRELLIS.2-4B`, `SAM-3D-Objects-3DGS`, `UniLat3D-Mesh`, `UniLat3D-3DGS`, `Pixal3D`, `PicGen3D`が追加されている——**運用は継続中だが、論文以降の新しいElo順位表は本調査では取得できなかった**。
- バックエンド到達不能の確認（[直接]）: フロントエンドの`src/lib/config.ts`が指すフォールバックAPI `https://3d-arena-3d-arena-backend.hf.space/leaderboard`は404（Hugging Faceの汎用404ページを返す）。フロントエンド自体の`/api/leaderboard`エンドポイントも`{"error":"Failed to fetch leaderboard."}`を返す。Wayback Machineのスナップショット（`web.archive.org/web/20260531193051/`）もJSレンダリングのSPAシェルのみで数値を含まない。**「現在の順位」は本調査の到達可能な範囲では取得できない。**
- 候補ベンダーとの突き合わせ（[直接] Dataset siblingsをキーワード検索）: `Rodin`, `Tripo`（`TripoSG`/`TripoSR`以外の完全一致なし）, `CSM`（Cubeのみ存在、"CSM"という文字列自体はTable内の表記のみ）, `Luma`, `Hyper3D`, `Sloyd`, `Kaedim`, `Backflip`, `Stability`のいずれについても、データセットの`outputs/`ディレクトリに該当エントリは0件——**この7ベンダー（CSM除く）はいずれも3D Arenaで一度も直接比較されていない**。

### 3.2 ベンダー — Meshy

一次ソース: [直接] `https://docs.meshy.ai/en/api/pricing`（テキスト抽出6000字）、`https://raw.githubusercontent.com/meshy-dev/game-asset-pipeline/main/README.md`（公式ゲーム向けクックブック）、[要約経由] `https://www.meshy.ai/pricing`（WebFetch）。

- 最新モデルは`meshy-7.1`（[直接]、docs.meshy.ai Pricingページの選択肢一覧）。
- Image to 3D APIの出力形式（[要約経由]、docs.meshy.aiの該当ページ）: "glb, obj, fbx, stl, usdz, 3mf"、`enable_pbr=true`で"PBR Maps (metallic, roughness, normal) in addition to the base color"を生成。
- 公式ゲーム向けREADME（[直接]、meshy-dev組織、game-asset-pipelineリポジトリ）:
  > "Mesh formats: GLB, FBX, OBJ" / "Texture maps: Diffuse, Roughness, Metallic, Normal (PBR-ready)" / "Poly range: 1,000 – 300,000 triangles (adjustable via Remesh)" / "UV mapping: Automatic UV unwrap on all outputs" / "Rigging: Humanoid auto-rig (compatible with Unity Humanoid and Unreal Mannequin)" / "Animation: 500+ presets exportable as FBX with embedded skeleton" / "Texture resolution: Up to 4K"
- クレジット価格（[直接]、docs.meshy.ai/en/api/pricing）: Image to 3D（メッシュのみ）20クレジット、2Kテクスチャ付き30クレジット、8Kテクスチャ付き35クレジット。Remesh 5クレジット、UV Unwrap 5クレジット、Auto-Rigging 5クレジット、Animation 3クレジット/アクション。
- サブスクリプション（[要約経由]、WebFetch on meshy.ai/pricing、生ページはJSレンダリングで直接取得不可だった）: Freeプラン100クレジット/月・CC BY 4.0ライセンス（帰属表示が必要＝商用利用しても出典明記義務が残る）。Proプラン1,000クレジット/月・private asset ownership（帰属表示不要の完全な所有権）。Studio/Enterpriseは価格詳細を取得できなかった[到達不能]。
- 非同期タスクAPI（[要約経由]）: `status`（PENDING/IN_PROGRESS/SUCCEEDED/FAILED/CANCELED）、`progress`（0-100）、`consumed_credits`、`preceding_tasks`のフィールドを持つポーリング型。
- GitHub上の開発者エコシステム（[直接] GitHub Search API）: 公式`meshy-dev`組織が`meshy-3d-agent`（96 stars）、`meshy-mcp-server`（49 stars）、`meshy-cli`（9 stars）、`game-asset-pipeline`（4 stars）を持つ。第三者の`prajwalshettydev/UnrealGenAISupport`（**652 stars**、pushed 2026-04-28）がUnreal Engine向けGenAI統合プラグインとしてMeshyを含む——本調査で確認した3Dゲーム素材生成AI関連の非公式リポジトリの中で最大の採用規模。

### 3.3 ベンダー — Tripo（Tripo3D、VAST AI Research系）

一次ソース: [直接] `https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/master/README.md`（公式Python SDK）、[直接/wayback] `http://web.archive.org/web/20260908162120/https://www.tripo3d.ai/pricing`（2026-09-08時点のスナップショット。`platform.tripo3d.ai/docs`はJS空シェル、`www.tripo3d.ai/pricing`へのWebFetchは403で直接到達不能だった）。

- 公式SDK機能一覧（[直接] README.md）:
  > "One-shot model animation (auto rig + retarget)" / "External model import (GLB / OBJ / FBX / STL)" / "Mesh editing including mesh segmentation, mesh completion and smart lowpoly" / "Model conversion and stylization" / "Rigging and retarget" / "Asynchronous API support"
  - `task_id`＋`wait_for_task()`による非同期タスクAPI、`TaskStatus.SUCCESS`判定、`check_balance()`によるクレジット残高確認API。
- 価格（[直接/wayback]、2026-09-08時点）:
  - Free: $0/月、200クレジット/月≈13モデル、**"Public Models · Non-Commercial Use"**、Free tierでも"Retopology"を含む"Essential Production Toolkit"にアクセス可。
  - Pro: $20/月（年払い$240/年）、3,000クレジット/月≈200モデル（**$0.16/モデル**）、"Private Models · Commercial Use"、Smart Mesh・Multi-view to 3D・Smart Segmentation・Ultra Mesh Qualityが追加。
  - Max: $90/月（年払い$1,080/年）、25,000クレジット/月≈1,660モデル（**$0.09/モデル**）、100同時タスク。
  - Team: $110/月/席（年払いだと$55/月/席・$1,980/年）、90,000クレジット/月≈6,000モデル、共有ワークスペース。
  - クレジット追加購入: $10で1,000クレジット、$100で10,000+2,000クレジット、$1,000で100,000+30,000クレジット。
- 実践者による実測（[直接]、Qiita、Gingnose、詳細は3.6節）: Ultraプランを月$10で1ヶ月契約したと記述——上記の公式$20/月Proプランと金額が食い違う（キャンペーン価格か、記述時点でのプラン体系が異なる可能性、[推測/未確認]）。
- GitHub上の開発者エコシステム（[直接]）: 公式`VAST-AI-Research/tripo-python-sdk`59 stars（pushed 2026-07-01）。`UnityEQ/Tripo3d-to-unity3d-plugin`（Unity向け非公式プラグイン、pushed 2026-09-24）、`VAST-AI-Research/Tripo3D-Plugin-dsh`（DeepSeek Harness向け公式プラグイン、"text/image → textured, rig-ready 3D assets via tripo-cli"、pushed 2026-09-20）が存在——公式が独自ハーネス連携まで手を広げている。

### 3.4 ベンダー — Rodin / Hyper3D（Deemos）

一次ソース: [直接] `https://hyper3d.ai/`（本文抽出387KB→テキスト化）、`https://hyper3d.ai/pricing`（282KB→テキスト化）。

- FAQより（[直接]）:
  > "What can I export from Hyper3D? Hyper3D supports common 3D formats such as STL, FBX, OBJ, GLB, GLTF, and USDZ. You can use STL for 3D printing, GLB/GLTF for web and AR workflows, **FBX for game engines**, OBJ for general 3D editing, and USDZ for Apple AR experiences."
  > "Can Hyper3D models be used in commercial projects? Yes, Hyper3D can support commercial workflows depending on your plan and license." （＝Freeプランは商用不可を含意）
  > "Hyper3D turns text or images into high-quality 3D assets with clean topology and PBR materials." （ベンダー自身の主張、独立検証なし）
- プラグイン一覧（[直接]、ナビゲーション部分）: "Plug-ins Blender Unity Unreal Godot Maya 3DS Max ComfyUI" ——本調査で確認した中で唯一、Unity/Unreal/Godotの3エンジン全てへの公式プラグインをトップページで明記しているベンダー。
- 価格（[直接]、hyper3d.ai/pricing）:
  > "Direct credits cost $1.5 per credit." / 月額$30プラン: "30 / mo" credits, "assetsMonthly":"~60"（≈**$0.50/モデル**、$1/クレジット換算） / 月額$60プラン: 60クレジット/月≈120モデル（同水準） / 月額$120プラン: 120クレジット/月≈240モデル / 年払いだと$0.8/クレジットに割引。
  - Freeプランは「確認してから支払う」("pay only when you confirm results")というpay-by-result型で、他社の月次クレジット制と異なる。
- 3D特化以外の広い機能（[直接]）: AIアバター（顔ディテール・ボディメッシュ一致・PBRマテリアル・facial controls付き）、AIテクスチャ生成、AI HDRI生成、3Dモデル検索エンジン、SVG→3D変換、3Dメッシュエディタ——単なるモデル生成器ではなく統合3D制作スイートとして展開。

### 3.5 ベンダー — CSM（Common Sense Machines）

一次ソース: [直接/wayback] `http://web.archive.org/web/20260115045612/https://csm.ai/`（本文抽出277KB）、`http://web.archive.org/web/20250714204824/https://www.csm.ai/pricing`（本文抽出314KB）。`csm.ai`の全サブドメインは本セッションのDNSで名前解決不可（`getaddrinfo ENOTFOUND`）だったため直接取得は断念——wayback上では2026-01時点でサイトが200を返しており、ベンダー自体が消滅したわけではない。

- トップページ（[直接/wayback]）:
  > "Transform images, text, and sketches into **game-ready 3D assets** and worlds. Trusted by world leading game studios, product designers and industrial designers." / "Supercharge your 3D workflows for **Unity, Unreal, Blender** and more" / "Image → Kit ... CSM Assets → Fortnite"
  - "Image to Kit for Parts-based Mesh Generation"がトップの見出し機能——パーツ単位でのメッシュ生成に特化した最新機能。Fortnite向けのアセットパイプラインを名指しで訴求している（マーケティングコピーであり第三者検証はない）。
- 価格（[直接/wayback]、2025-07-14スナップショット）:
  - Tinkerer（無料）: 10クレジット（≈10生成）、"Image to 3D / Text to 3D / Chat to 3D / **AI Retopology (Swift)** / Multiview image upload / PBR Texture / AI Retexture / Blender MCP"、**"Content under CC by 4.0 license"**（Meshy Freeと同じ帰属表示条件）、API access含む。
  - Maker: $20/月、100クレジット/月（≈**$0.20/モデル**）、"Image to Kit"追加、"Content is private & customer-owned"。
  - Creative Pro: $60/月、400クレジット/月（≈**$0.15/モデル**）。
  - Prime: $111/月、1,000クレジット/月（≈**$0.11/モデル**）、"3D Video Studio"追加。
  - Enterprise: 要問い合わせ。
- 無料プランでも"AI Retopology (Swift)"というリトポロジー専用機能を明記している点は、他社（MeshyのRemeshは無料でも使えるが有料クレジット消費、Tripoのretopologyは無料プランの範囲内）と比べても手厚い。

### 3.6 実践者 — Zenn / Qiita（日本語圏、AI著者記事を除外して精読）

一次ソース: [直接] Zenn検索API (`zenn.dev/api/search?source=articles`)、Qiita検索API (`qiita.com/api/v2/items`)、該当記事のHTML本文（Next.js埋め込みJSONを復号）を全文取得。

- **Meshy、lycoris52「Meshy AI で作ったぐちゃぐちゃなテクスチャを Blender で直す」**（[直接]、AI著者表記なし、URL: `zenn.dev/lycoris52/articles/63be23cc0bf486`）:
  > "MeshyAI で生成したテクスチャ画像を開くと、見た目がかなりぐちゃぐちゃしている...レンダー上では問題ありませんが...これはテクスチャ自体が壊れているわけではなく、UV 展開が細かい島に分かれていて、その UV に合わせてテクスチャが配置されている状態です。"
  - この著者はゲーム開発で複数のAIを試している最中で、Meshyのボーン・モーション付与を「簡単」と評価しつつ、テクスチャPNGを直接編集する必要がある場面（顔の色調整など）でUV分断が致命的に不便だったと記録。対処としてBlenderで新規UVをSmart UV Projectで再作成し、Emissionベイクで焼き直す手順を詳述。結論は「テクスチャの問題などはありますが...AI生成モデルをUnityなどで実際に使いたい場合、この手順を覚えておくとかなり便利」——**完全な否定ではなく、追加の手作業込みで実用に持ち込んだ**という中間的な評価。
- **Tripo、Gingnose「tripo で生成した 3D mesh を blender で処理するパイプラインが結構良さそう」**（[直接]、AI著者表記なし、URL: `qiita.com/Gingnose/items/661226ba1098500fe442`）:
  > "設定は Ultra, generate in parts, triangle mesh で poly count は 150K...quad の方が poly count の数は増やせますが、generate in parts ができないので、triangle で poly count を max にしました" / "fidelity が高く、高ポリゴンを維持したまま出力でき、blender, UE5 などの DCC に持ち込めるという点において良いと思います...UE5 がパイプラインの最終にあることを考えて FBX形式で export しました" / "自動生成したモデルはバイクの anatomy を理解しているわけじゃないので、ここは手作業で分離したり統合、refine していく必要があります"
  - バイクという機械物の複数パーツ生成をTripoで試し、UE5への持ち込みを前提にFBXを選択。「quadモードだとパーツ分割生成が使えない」という具体的な機能制約、Blender import後のスケール補正の必要性、Claude Opus 4.6にBlenderのノード座標を渡してパーツ名を自動推定させるワークフローまで実演——**実運用に近い、地に足のついた記録**。
- **AI著者記事のパターン確認（方法論上の発見）**: Qiita検索でヒットした「ローカル3D生成の覇権交代？Hunyuan3Dを諦めてMicrosoftの「Trellis.2 4B」に乗り換えた話」（roripika名義、[直接]、`qiita.com/roripika/items/85c6e71fe1d0b7ccda1e`）は本文冒頭に:
  > "[!IMPORTANT] この記事は AI（Antigravity / Gemini が起草、Claude Code が加筆・技術検証）によって執筆され、Qiita API を通じて自動投稿されたものです。"
  との明記があった。同様に「Hunyuan3D-2のライセンスを非商用と誤読していた」記事（claute_colo名義、[直接]、`qiita.com/claute_colo/items/38c54769ca81e41b4610`）も著者が本文中で「私はAI、玄人こーろ」と自称している。**両記事とも技術的に具体的な数値（頂点数比較、生成時間、ビルド手順）を含み内容自体は詳細だが、実在の人間が実機検証した一次体験として扱うのは不適切**——本調査ではこの2件を実践者証拠から除外し、この除外の理由（日本語圏の3D生成AI「体験記」の一部がAIゴーストライティングで生成されている）自体を独立した発見として記録する。

### 3.7 実態（in the wild）— GitHub採用シグナル

一次ソース: [直接] `curl` + `api.github.com`（GitHub REST/Search API）。

| リポジトリ | stars | 最終push | 備考 |
|---|---|---|---|
| prajwalshettydev/UnrealGenAISupport | 652 | 2026-04-28 | Unreal Engine向け非公式GenAI統合、Meshy含む。本調査で確認した中で最大 |
| meshy-dev/meshy-3d-agent | 96 | 2026-09-23 | 公式、直近も活発 |
| meshy-dev/meshy-mcp-server | 49 | 2026-09-22 | 公式MCPサーバー |
| VAST-AI-Research/tripo-python-sdk | 59 | 2026-07-01 | Tripo公式Python SDK |
| VAST-AI-Research/Tripo3D-Plugin-dsh | 4 | 2026-09-20 | 公式、DeepSeek Harness向け |
| DeemosTech/rodin3d-skills | 17 | 2026-05-25 | Rodin公式（Deemos社） |
| Kaedim/working-at-kaedim | 50 | 2026-06-10 | 採用ページ用リポジトリ（開発ツールではない） |
| David-Allen-Arteaga/UnityPlugin (Sloyd) | 2 | 2025-01-03 | Sloyd非公式Unityプラグイン、低採用 |

- Meshy・Tripo・Rodinの3社は公式組織が能動的に開発者向けオープンソースツール（SDK・CLI・MCPサーバー・game-asset-pipelineクックブック）を出しており継続的にpushされている。CSM（DNS不通のため確認不能）、Sloyd（非公式Unityプラグインが2 starsのみ）、Kaedim（採用ページ以外に開発者向けリポジトリが見当たらない）は開発者エコシステムの厚みで明確に見劣りする。
- Hugging Face Models API（[直接]）でも2026-09-30時点で`Hunyuan3D-3.0`または`3.x`という名称の公開重みは存在しない（既存調査を再確認、直近の`Hunyuan3D`関連モデルカードは全て`2.0`/`2.1`/`2mini`/`Part`系列）——Tencentの3.x/PolyGen系の進化は完全にクローズドソース化している。

### 3.8 測定/ベンダー研究 — Hunyuan3D Studio論文（arXiv 2509.12815）

一次ソース: [直接] `https://huggingface.co/api/papers/search?q=Hunyuan3D+Studio`、`https://export.arxiv.org/abs/2509.12815`。

> "Hunyuan3D Studio integrates a suite of advanced neural modules (such as Part-level 3D Generation, Polygon Generation, Semantic UV, etc.) into a cohesive and user-friendly system... We demonstrate that assets generated by Hunyuan3D Studio are not only visually compelling but also adhere to the stringent technical requirements of contemporary game engines..." [直接、Abstract全文]

Tencent自身の研究チーム（Tencent Hunyuan、著者50名超）による論文で、`3d.hunyuan.tencent.com`のPolyGen機能（既存調査で確認済み）の技術的裏付けにあたる。しかし**Abstractに定量数値は一切無く**（"demonstrate"「実証する」という主張のみ）、第三者による独立検証（3D Arenaへの参加や人間評価との比較）も本調査では見つからなかった——ベンダー自身の論文という性質上、宣伝的な記述に留まる可能性が高い[推測]。

### 3.9 ネガティブ・エビデンス — Luma Genieの後退、Kaedimの人間労働報道、Backflipのスコープ違い

- **Luma Genie**（[直接]、`lumalabs.ai/genie`のHTML `<title>`と`canonical`を直接確認）: `title: "Luma | AI Agents for Creative Work"`、`canonical: "https://lumalabs.ai"`——`/genie`という専用URLがトップページへ実質的にcanonical/リダイレクトされている。トップページ本文および`/api`ページ本文のいずれにも"3D"・"genie"・"mesh"という文字列は0件（[直接]、grep）。Lumaは動画生成・汎用クリエイティブAIエージェントへ製品軸を移したように見える——**3D生成が独立製品として現役かどうか、一次資料からは確認できなかった**。
- **Kaedim**（[直接] 404media.co、2023-09-06付、Joseph Cox・Jason Koebler）:
  > "An artificial intelligence company, whose founder Forbes included in a 30 Under 30 list recently, promises to use machine learning to convert clients' 2D illustrations into 3D models. In reality the company, called Kaedim, uses human artists for 'quality control.'"
  - 2023年の報道であり、2026年現在の実態を保証するものではない[推測/未確認]が、Kaedim自身の現在の`/pricing`ページには価格表が無く問い合わせ制のみ（[直接]）——自動化されたセルフサーブAPIとしての実態確認が本調査ではできなかった。
- **Backflip**（[直接] `backflip.ai`トップページ本文）: 「The AI copilot that CADs like a human」——メッシュ→パラメトリックCAD変換ツールであり、テキスト/画像からゲーム用メッシュを生成する製品ではない。比較対象として不適格。

---

## 4. 比較表

| ソース | 種別 | 対象 | 結果・数値 | コスト数値 | ライセンス/所有権 | 既知の失敗モード・注意点 |
|---|---|---|---|---|---|---|
| 3D Arena論文 (arXiv 2506.18787) | 測定[直接] | 19モデルの人間選好Elo | CSM/Cube 1位(1405)、TRELLIS-3DGS 2位(1384)、Meshy 9位(1243)、TripoSR 17位(1089)、IM-MA(リトポロジー志向) 18位最下位(1016) | — | — | splatが+16.6 Elo、texturedが+144.1 Elo優遇——視覚的第一印象へのバイアスをToC自身が認めている。現在の順位は取得不能（backend 404） |
| docs.meshy.ai Pricing | ベンダー[直接] | Meshy API全機能価格 | meshy-7.1、Remesh 5cr、Auto-Rig 5cr、Image to 3D 20-35cr | Free 100cr/月、Pro 1000cr/月[要約経由] | Free=CC BY 4.0(帰属表示必須)、Pro=private ownership[要約経由] | Studio/Enterprise価格は到達不能 |
| meshy-dev/game-asset-pipeline | ベンダー[直接] | ゲーム向けスペック | ポリ数1,000-300,000(Remeshで調整)、Unity Humanoid/Unreal Mannequin互換リグ、500+アニメプリセット | — | — | 公式GitHub Cookbookでdocsサイトの範囲外の情報 |
| tripo-python-sdk README | ベンダー[直接] | Tripo API機能 | auto rig+retarget、smart lowpoly、GLB/OBJ/FBX/STL入出力 | — | — | remesh/quadトポロジー制御の明記はSDK README中に無い |
| tripo3d.ai/pricing (wayback) | ベンダー[直接/wayback] | Tripoサブスク | Free 200cr(≈13モデル)、Pro $20/月(≈200モデル=$0.16/モデル)、Max $90/月($0.09/モデル) | 上記 | **Freeは非商用限定**、Pro以上で商用・非公開 | 2026-09-08時点のスナップショット、現在と異なる可能性 |
| hyper3d.ai + /pricing | ベンダー[直接] | Rodin機能・価格 | FBX="for game engines"と明記、Unity/Unreal/Godot/Blender/Maya/3DS Max/ComfyUIプラグイン、$1.5/クレジット、月$30で≈$0.50/モデル | 上記 | Free=商用制限、paid=商用可("depending on plan") | 「clean topology」はベンダー自身の主張、独立検証なし |
| csm.ai + /pricing (wayback) | ベンダー[直接/wayback] | CSM機能・価格 | "game-ready 3D assets"、"CSM Assets→Fortnite"、AI Retopology(Swift)標準搭載、Maker $20/月($0.20/モデル) | 上記 | Free=CC BY 4.0、$20+=private・customer-owned | 本セッションのDNSで直接到達不能(wayback代替) |
| 404media.co (Kaedim報道) | 実態/否定的[直接] | AI/人間労働の実態 | "uses human artists for quality control"、一部は人間が完全手作業で制作 | — | — | 2023年の報道、2026年の実態は未確認。pricing非公開(問い合わせ制) |
| lumalabs.ai/genie, /api | ベンダー否定的[直接] | 製品の現役性 | "/genie"が"AI Agents for Creative Work"にcanonical、3D関連語彙0件 | — | — | 3D生成が現役製品か不明 |
| backflip.ai | ベンダー[直接] | 製品スコープ | "CADs like a human"、mesh→parametric CAD変換 | — | — | ゲーム素材生成ツールではない(比較対象外) |
| arXiv 2509.12815 (Hunyuan3D Studio) | ベンダー研究[直接] | PolyGen/Semantic UVの技術基盤 | "adhere to stringent technical requirements of contemporary game engines"(数値なし) | — | — | 第三者検証なし、公開重みなし(HF Models APIで0件) |
| Zenn, lycoris52 (Meshy) | 実践者[直接] | UV/テクスチャ品質 | レンダー上は正常だがPNGのUVが細片化、Blenderで手動再UV+再ベイクが必要 | — | — | 個人の実機体験、1件のみ |
| Qiita, Gingnose (Tripo) | 実践者[直接] | パーツ分割生成の制約 | quad選択時はgenerate in parts不可→triangleで最大150Kポリ、UE5持ち込み後も手作業のパーツ分離が必要 | Ultra $10/月(公式価格と不一致、[推測/未確認]) | — | 個人の実機体験、1件のみ |
| Qiita, roripika/claute_colo | [AI著者/要注意] | Hunyuan3D比較 | 頂点数・生成時間の具体的数値を含むが著者がAIと自己申告 | — | — | 実践者証拠としては不採用、方法論上の発見として記録 |
| GitHub Search API | 実態[直接] | 開発者エコシステム規模 | Meshy関連最大652 stars、Tripo公式SDK 59 stars、Rodin公式17 stars、Sloyd非公式2 stars、Kaedim開発ツールほぼ皆無 | — | — | CSMはドメイン重複で検索不能 |
| HF Models API | 実態[直接] | Hunyuan3D 3.x公開重み | 0件(2.0/2.1/2mini/Partのみ) | — | — | 3.x系はクローズドソース化 |

---

## 5. 何が言えて、何が言えないか

**言えること（証拠のある事実）:**

- ホスト型API（Meshy・Tripo・Rodin/Hyper3D・CSM）は、ゲームアセット制作パイプラインの5要素（リメッシュ/リトポロジー、PBRテクスチャ、GLB/FBX複数形式出力、自動リギング、エンジン公式プラグイン）を4社とも一次資料で確認できる形で満たしている。オープンソースのローカルモデル（Hunyuan3D-2.1、TRELLIS.2等、既存調査で確認済み）は生メッシュ生成に強いが、リトポロジー・リギング・UV展開のいずれもモデル本体の機能ではなく、コミュニティ製ComfyUIノードに依存する——既存調査の結論と本調査のベンダー機能比較が一致した。
- 唯一の大規模定量評価（3D Arena、123,243票）は、人間の選好が視覚的インパクト（スプラット形式、テクスチャの有無）に系統的に偏っており、トポロジー品質を優先したモデル（IM-MA）が最下位になるという逆転現象を論文自身が認めている。**ゲーム制作が求める「クリーンなトポロジー」を測る定量指標は、2026-09-30時点で存在しない**。
- 無料プランのライセンス条件は4社中3社（Meshy・Tripo・CSM）が制限付き（CC BY 4.0の帰属表示義務、またはNon-Commercial Use）であり、個人インディー開発者が商用ゲームに無料枠のアウトプットをそのまま使うことは、少なくとも規約上は推奨されない。有料プランでのモデル単価は確認できた範囲でTripo Pro（$0.16/モデル）＜CSM Maker（$0.20/モデル）＜Rodin月額プラン（$0.50/モデル）の順で、Rodinが最も高い。
- Kaedimは2023年に「AIと称して人間労働を使っていた」という具体的な報道があり、かつ2026年時点でも公開のセルフサーブ価格を持たない——他4社と同列の「セルフサーブAPI」として扱うべきではない。
- Backflipはメッシュ→CAD変換ツールであり、そもそも比較対象の製品カテゴリに属さない。Luma Genieは2026-09-30時点で公式サイトから3D関連の語彙が実質的に消えており、独立した現役製品としての証拠が見つからなかった。

**言えないこと・裏付けが弱いこと:**

- 「どのAPI／ローカルモデルが最終的に一番ゲーム素材として品質が高いか」を単一の数値で順位付けることはできない。3D Arenaのリーダーボードはトポロジー品質と逆相関する可能性が論文自身の分析で示されており、そのままゲーム素材の品質指標として使うのは誤用にあたる。かつTripo・Rodin・CSM・Sloyd・Kaedim・Backflip・Stabilityの商用ホスト型APIは、そもそも一度もこのリーダーボードで比較されていない。
- Tripoの実践者記事が記述した「Ultra $10/月」という価格は、公式wayback価格ページの「Pro $20/月」と食い違う——タイミングや対象プランの違いによる可能性が高いが、本調査では解消できなかった[推測/未確認]。
- Hunyuan3D 3.x / PolyGenの実際のゲーム素材品質（ポリゴン削減率、リトポロジーの品質）は、Tencent自身の論文Abstractにすら定量数値が無く、第三者による独立検証も見つからなかった——ホスト型SaaS（`3d.hunyuan.tencent.com`）自体がJSレンダリングのSPAで直接内容確認ができなかったため、機能の存在は既存調査の二次情報（genvr.ai、blenderloop.com、いずれも[要約経由]）にとどまる。
- 「複数アセット間のスタイル一貫性」については、Rodinの「Styles 21種プリセット」程度のマーケティング上の機能列挙以外、独立した測定や実践者による評価は本調査では見つからなかった。
- Kaedimの2023年報道が2026年現在も当てはまるかどうかは確認できていない——同社は撤回・反論記事も出していないが、現在のホームページは「full ownership and commercial rights」を強調しており体制変更の可能性もゼロではない。
- Stability AIが自社ホスト型APIとして3D生成エンドポイント（Stable Fast 3D / SPAR3D相当）を提供しているかどうかは、`platform.stability.ai`が完全にJSレンダリングでcurl・WebFetch双方で内容を取得できず、確認できなかった[到達不能]。オープンウェイト版のライセンス（Stability AI Community License、年商$100万未満無料）は既存調査で確立済みだが、ホスト型APIの価格・仕様は不明のまま。

**欠けているもの:**

- 「ゲーム素材向けに特化した」定量的な品質ベンチマーク・リーダーボード。3D Arenaはこの目的のために設計されたものではなく、論文自身が「今後の課題」としてトポロジー特化のEloを提案しているが未実装。
- Tripo・Rodin/Hyper3D・CSM・Sloyd・Kaedimそれぞれについて、複数の独立した実践者による「試して、うまくいかず別のツールに戻した」という否定的な一次体験談。本調査で見つかった実践者記事は各ベンダーにつき最大1件（Meshy、Tripo）にとどまり、Reddit（r/gamedev、r/Unity3D、r/godot）には到達できなかった。
- 現在（2026-09時点）の3D Arena Elo順位。バックエンドが404を返しており、2025-05-30スナップショット以降の数値は本調査では取得不能。
- 現在のKaedimの実際のワークフロー（AI比率・人間比率）についての、2023年報道以降の第三者検証。

---

## 6. 「前例なし」リスト（no precedent found）

- 「ゲーム素材としての品質」（トポロジー・UV・リグ互換性）を軸にした、ホスト型API横断の定量ベンチマーク・リーダーボード。
- Tripo・Rodin/Hyper3D・CSM・Sloyd・Kaedim・Backflip・Stabilityそれぞれについて、複数の独立した名指しの実践者による「試して、うまくいかず別の選択肢に戻した」という否定的な一次体験談（各社1件以下）。
- 2026-09時点（論文の2025-05-30スナップショットより新しい）の3D Arena Elo順位の公開データ。
- Hunyuan3D 3.x / PolyGen（ホスト型SaaS限定機能）の、Tencent自身の論文Abstract以外での、第三者による定量的な品質検証。
- 「複数アセット間のスタイル一貫性」を定量的に測定した、いずれのベンダー・研究・実践者による評価。
- Kaedimの2023年報道（AIと称した人間労働）に対する、2024年以降の第三者による追跡調査・検証・撤回記事。
- Reddit（r/gamedev、r/Unity3D、r/godot）上でのこれらAPI/ローカルモデルの実践者比較（本セッションでは403で到達不能）。

---

## 出典一覧

- 3D Arena Space (Hugging Face): https://huggingface.co/spaces/dylanebert/3d-arena
- 3D Arena Dataset: https://huggingface.co/datasets/3d-arena/3d-arena
- 3D Arena論文 (arXiv 2506.18787): https://arxiv.org/abs/2506.18787 / PDF: https://arxiv.org/pdf/2506.18787
- Meshy Pricing docs: https://docs.meshy.ai/en/api/pricing
- Meshy公式ゲーム向けクックブック: https://raw.githubusercontent.com/meshy-dev/game-asset-pipeline/main/README.md
- Meshy公式サイト価格ページ: https://www.meshy.ai/pricing
- Tripo公式Python SDK: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/master/README.md
- Tripo価格ページ(wayback): http://web.archive.org/web/20260908162120/https://www.tripo3d.ai/pricing
- Rodin/Hyper3Dトップページ: https://hyper3d.ai/
- Rodin/Hyper3D価格ページ: https://hyper3d.ai/pricing
- CSMトップページ(wayback): http://web.archive.org/web/20260115045612/https://csm.ai/
- CSM価格ページ(wayback): http://web.archive.org/web/20250714204824/https://www.csm.ai/pricing
- Luma Genie/API: https://lumalabs.ai/genie , https://lumalabs.ai/api
- Sloyd: https://www.sloyd.ai/ , https://www.sloyd.ai/pricing
- Kaedim: https://www.kaedim3d.com/ , https://www.kaedim3d.com/pricing
- Backflip: https://www.backflip.ai/
- 404 Media (Kaedim報道): https://www.404media.co/kaedim-ai-startup-2d-to-3d-used-cheap-human-labor/
- Hunyuan3D Studio論文 (arXiv 2509.12815): https://export.arxiv.org/abs/2509.12815 / HF Papers: https://huggingface.co/api/papers/search?q=Hunyuan3D+Studio
- Zenn記事 (lycoris52、Meshy UV問題): https://zenn.dev/lycoris52/articles/63be23cc0bf486
- Qiita記事 (Gingnose、Tripo→Blender→UE5): https://qiita.com/Gingnose/items/661226ba1098500fe442
- Qiita記事 (roripika、AI著者表記あり、参考扱い): https://qiita.com/roripika/items/85c6e71fe1d0b7ccda1e
- Qiita記事 (claute_colo、AI著者表記あり、参考扱い): https://qiita.com/claute_colo/items/38c54769ca81e41b4610
- GitHub Search API (各ベンダーSDK/プラグイン採用状況): https://api.github.com/search/repositories
- Hugging Face Models API (Hunyuan3D 3.x公開重み不在の確認): https://huggingface.co/api/models?search=hunyuan3d
- 既存調査（前提として引用のみ、再検証せず）: `./2026-09-30-3d-generation-runtime.md` , `./2026-09-30-one-gpu-llm-and-3d-generation.md`

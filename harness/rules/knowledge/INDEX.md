# Knowledge

Stock: facts that outlive the investigation that found them, promoted from
research records by the `records-triage` skill
(`../decisions/2026-09-27-records-flow-and-stock.md`). Read this before
researching anything; a fact here is settled until a line below says
otherwise. One line per note: `- [question](file.md) — the answer, with the
date it was last checked`.

- [google/ax、rulesync、jev（TypeSafe の決定モデル API）は jig の設計にどう使えるか](jig-external-tool-relevance-surveys.md) — google/ax の冪等セットアップ設計と rulesync の正規化＋型付き上書きパターンは採用に値するが、コードの vendor 化や jev 単独でのスキル選択の置き換えは根拠なし (2026-09-22)
- [ルールベースのツールコール・ガードは十分なセキュリティ境界か、専用の判断モデルはどこまで有効か](agent-harness-architecture-paradigms.md) — ガードは OS サンドボックスの上の防御層の一つで境界そのものではない。判断モデルはモデル階層ルーティングだけ裏付けがあり、スキル選択・圧縮は未検証 (2026-09-22)
- [omp（oh-my-pi）の hook・承認・設定階層・サンドボックスの実際の仕様は何か](omp-hook-and-permission-surface.md) — Claude Code より豊富な hook・承認・設定階層を持つが、OS レベルのサンドボックスは持たず外部の境界が前提 (2026-09-22)
- [コーディングエージェントのサンドボックス境界は誰が持つべきか](sandbox-ownership-devcontainer.md) — ハーネス本体が持つのが主流。横断の標準化は devcontainer.json、ハーネス非依存の動的選択層は前例なし (2026-09-22)
- [GLM-5.3 は main tier で DeepSeek Flash を置き換える根拠になるか](main-tier-model-alternatives-evaluated.md) — 品質は上だがコスト約 7.4 倍・速度劣化・構造化出力のバグ・サブスク対象外のリスクがあり、置き換えの根拠は薄い (2026-09-23)
- [サードパーティのコーディングハーネスは Claude/ChatGPT のサブスク OAuth トークンを使ってよいか、認証失敗時に黙って別の経路へ落ちるか](vendor-subscription-oauth-tos-risk.md) — Anthropic は条件付きで容認しつつ BAN の事例もある。omp と pi は設計が対照的だが、どちらも黙って落ちる不具合を抱える (2026-09-23)
- [macOS（nix-darwin）と非 NixOS の Linux（Arch 系）を一つの Nix flake で構成するときの型](nix-flake-multi-system-layout.md) — ホスト名キーの共有関数に Linux 側は standalone home-manager を薄く足す形が、唯一完全に一致する実例で裏付けられる (2026-09-23)
- [omp（oh-my-pi）のプラグイン機構は何を配布でき、信頼モデルはどうなっているか](omp-plugin-trust-and-format.md) — 配布範囲は広いがサンドボックスなしの信頼済みコード実行で、業界標準と呼べるプラグインはまだない (2026-09-24)
- [llama-server の router モードを systemd --user と CUDA でどう運用するか](llama-server-router-cuda.md) — router モードの CLI は README で確定。アイドルと GPU メモリ解放の未解決バグが 2 件残り、CUDA 版は公式 nightly が最も手数が少ない (2026-09-25)
- [zellij 0.44 系で harpoon が壊れたときの代わりは何か](zellij-harpoon-alternatives.md) — 本家は 16 か月放置。shihanng/zellij-pane-picker が最有力だが、公式配布の wasm は古いクレートのビルドのまま (2026-09-25)
- [Homebrew でしか入れていなかった CLI を Linux でどう入れるか](cli-tool-nix-packaging.md) — herdr・wtp・thefuck・codex は Nix で足り、mo だけが名前の衝突で自作の導出が要る (2026-09-26)
- [Docker エンジンをログイン時に確実に起動するには](docker-autostart-macos-omarchy.md) — OrbStack はヘッドレス起動を公式に支援せず、systemd・launchd とも依存を宣言できないので、待つループが業界の型 (2026-09-26)
- [前の dotfiles 方式の残骸をどう片付けるか](dotfiles-migration-cleanup.md) — 無条件に自動で消す道具は無く、範囲を限った自動・opt-in のフラグ・別コマンドの 3 型だけ (2026-09-26)
- [k1LoW/mo が使えなくなった後、Markdown をどうプレビューするか](markdown-preview-tools.md) — 用途で使い分ける（glow・render-markdown.nvim・npx mdts）。mo 一本の代わりは無い (2026-09-26)
- [Omarchy（v4 Quattro）で何をどこでカスタマイズできるか](omarchy-quattro-customization.md) — バーとテーマの仕組みは明確だが、公式コマンド自体がリンク管理を壊す。Quattro への移行でコミュニティのテーマに不具合が続いている (2026-09-26)
- [コーディングエージェントのステータスラインはどう作られているか](statusline-across-harnesses.md) — 外部コマンドの契約を持つのは Claude Code だけで、他は拡張 API 方式。pi と omp の間でも互換がない (2026-09-27)
- [スキル選択ルーターの言い回しの実験は何を測ったか](skill-selection-router-experiment.md) — 4 つの言い回しに有意差はなし。選択式は較正が良いが、確率分布が配線の都合で取れず、昇格の判定は未決 (2026-09-23)
- [文脈窓と圧縮の発火点を、ベンダーと実践者はどう設定しているか](context-compaction-practice.md) — ベンダーの既定は窓の 50〜98%。実践者の先回りの値は数万〜17 万で、決定の 850,000 はそれより大きいという未決着点がある (2026-09-27)
- [疲れた読者が一読で分かる説明文と図は、どう書くか](clear-writing-checklist.md) — 最重要を先頭、1 段落 1 つの考え、記述的な見出し、具体例、説明文は理由と代わりの案まで。図は仕組みを伝えるときだけ。文の長さの数値目標は作らない (2026-09-22)

# Knowledge

Stock: facts that outlive the investigation that found them, promoted from
research records by the `records-triage` skill
(`../decisions/2026-09-27-records-flow-and-stock.md`). Read this before
researching anything; a fact here is settled until a line below says
otherwise. One line per note: `- [question](file.md) — the answer, with the
date it was last checked`.

- [google/ax、rulesync、jev（TypeSafeの決定モデルAPI）はjigの設計にどう使えるか](jig-external-tool-relevance-surveys.md) — google/axの冪等セットアップ設計とrulesyncの正規化＋型付き上書きパターンは採用に値するが、コードのvendor化やjev単独でのスキル選択の置き換えは根拠なし (2026-09-22)
- [ルールベースのツールコール・ガードは十分なセキュリティ境界か、専用の判断モデルはどこまで有効か](agent-harness-architecture-paradigms.md) — ガードはOSサンドボックスの上の防御層の一つで境界そのものではない。判断モデルはモデル階層ルーティングだけ裏付けがあり、スキル選択・圧縮は未検証 (2026-09-22)
- [omp（oh-my-pi）のhook・承認・設定階層・サンドボックスの実際の仕様は何か](omp-hook-and-permission-surface.md) — Claude Codeより豊富なhook・承認・設定階層を持つが、OSレベルのサンドボックスは持たず外部の境界が前提 (2026-09-22)
- [コーディングエージェントのサンドボックス境界は誰が持つべきか](sandbox-ownership-devcontainer.md) — ハーネス本体が持つのが主流。横断の標準化はdevcontainer.json、ハーネス非依存の動的選択層は前例なし (2026-09-22)
- [GLM-5.3はmain tierでDeepSeek Flashを置き換える根拠になるか](main-tier-model-alternatives-evaluated.md) — 品質は上だがコスト約7.4倍・速度劣化・構造化出力のバグ・サブスク対象外のリスクがあり、置き換えの根拠は薄い (2026-09-23)
- [サードパーティのコーディングハーネスはClaude/ChatGPTのサブスクOAuthトークンを使ってよいか、認証失敗時に黙って別の経路へ落ちるか](vendor-subscription-oauth-tos-risk.md) — Anthropicは条件付きで容認しつつBANの事例もある。ompとpiは設計が対照的だが、どちらも黙って落ちる不具合を抱える (2026-09-23)
- [macOS（nix-darwin）と非NixOSのLinux（Arch系）を一つのNix flakeで構成するときの型](nix-flake-multi-system-layout.md) — ホスト名キーの共有関数にLinux側はstandalone home-managerを薄く足す形が、唯一完全に一致する実例で裏付けられる (2026-09-23)
- [omp（oh-my-pi）のプラグイン機構は何を配布でき、信頼モデルはどうなっているか](omp-plugin-trust-and-format.md) — 配布範囲は広いがサンドボックスなしの信頼済みコード実行で、業界標準と呼べるプラグインはまだない (2026-09-24)
- [llama-serverのrouterモードをsystemd --userとCUDAでどう運用するか](llama-server-router-cuda.md) — routerモードのCLIはREADMEで確定。アイドルとGPUメモリ解放の未解決バグが2件残り、CUDA版は公式nightlyが最も手数が少ない (2026-09-25)
- [zellij 0.44系でharpoonが壊れたときの代わりは何か](zellij-harpoon-alternatives.md) — 本家は16か月放置。shihanng/zellij-pane-pickerが最有力だが、公式配布のwasmは古いクレートのビルドのまま (2026-09-25)
- [Homebrewでしか入れていなかったCLIをLinuxでどう入れるか](cli-tool-nix-packaging.md) — herdr・wtp・thefuck・codexはNixで足り、moだけが名前の衝突で自作の導出が要る (2026-09-26)
- [Dockerエンジンをログイン時に確実に起動するには](docker-autostart-macos-omarchy.md) — OrbStackはヘッドレス起動を公式に支援せず、systemd・launchdとも依存を宣言できないので、待つループが業界の型 (2026-09-26)
- [前のdotfiles方式の残骸をどう片付けるか](dotfiles-migration-cleanup.md) — 無条件に自動で消す道具は無く、範囲を限った自動・opt-inのフラグ・別コマンドの3型だけ (2026-09-26)
- [k1LoW/moが使えなくなった後、Markdownをどうプレビューするか](markdown-preview-tools.md) — 用途で使い分ける（glow・render-markdown.nvim・npx mdts）。mo一本の代わりは無い (2026-09-26)
- [Omarchy（v4 Quattro）で何をどこでカスタマイズできるか](omarchy-quattro-customization.md) — バーとテーマの仕組みは明確だが、公式コマンド自体がリンク管理を壊す。Quattroへの移行でコミュニティのテーマに不具合が続いている (2026-09-26)
- [コーディングエージェントのステータスラインはどう作られているか](statusline-across-harnesses.md) — 外部コマンドの契約を持つのはClaude Codeだけで、他は拡張API方式。piとompの間でも互換がない (2026-09-27)
- [スキル選択ルーターの言い回しの実験は何を測ったか](skill-selection-router-experiment.md) — 4つの言い回しに有意差はなし。選択式は較正が良いが、確率分布が配線の都合で取れず、昇格の判定は未決 (2026-09-23)
- [文脈窓と圧縮の発火点を、ベンダーと実践者はどう設定しているか](context-compaction-practice.md) — ベンダーの既定は窓の50〜98%。実践者の先回りの値は数万〜17万で、決定の850,000はそれより大きいという未決着点がある (2026-09-27)
- [疲れた読者が一読で分かる説明文と図は、どう書くか](clear-writing-checklist.md) — 最重要を先頭、1段落1つの考え、記述的な見出し、具体例、説明文は理由と代わりの案まで。図は仕組みを伝えるときだけ。文の長さの数値目標は作らない (2026-09-22)

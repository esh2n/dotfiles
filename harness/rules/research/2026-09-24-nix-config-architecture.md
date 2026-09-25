# Nix 設定リポジトリを「アプリケーション」として設計する — モジュールシステム=DI、リポジトリアーキテクチャ、テスト、payload/wiring 分離の調査

調査日: 2026-09-24。前提として再調査しない既読4本: `2026-09-24-role-based-dotfiles.md`（digga の Profiles/Suites 撤回、`mkOutOfStoreSymlink` 未解決バグ2件、ayats.org の home-manager 離脱、yadm/chezmoi/Ansible の役割選択思想比較）、`2026-09-24-dotfiles-architecture.md`（holman/twpayne/mathiasbynens/thoughtbot の非Nix構造比較、mackup の symlink 設計が macOS 14 で壊れた事例、CI/テストの3独立記事）、`2026-09-23-multi-system-flake-layout.md`（`mkSystem` 共有関数、hostname キー、`forAllSystems` の適用範囲、sanketsudake が唯一の macOS(nix-darwin)+実機Arch(standalone home-manager)完全一致例）、`2026-09-24-steelman-nix.md`（sops-nix vs opnix vs `op run`、skippednote の chezmoi→nix-darwin 移行実測、macOS 27 での新規破損、home-manager 977件のopen issue）。本記録はこれらの**続き**であり、「role」の選び方や `mkOutOfStoreSymlink` の穴は再調査しない。今回の焦点はモジュールシステムそのものの DI としての性質、リポジトリレベルのアーキテクチャ（flake-parts/dendritic/snowfall-lib/std/haumea/import-tree/ez-configs）、cross-platform 共有の実装詳細、テスト/CI、payload と wiring の分離。

## 0. 方法・検証凡例

- `[直接]` — `curl`/`raw.githubusercontent.com`/`api.github.com`（`gh auth status` は keyring 再ログインエラーを出すが、`gh auth token` の値自体は `Authorization: Bearer` ヘッダとして有効）、または `nix.dev`/`nixos.org`/`wiki.nixos.org`/`flake.parts` 等のドキュメントサイトを HTML 取得しタグを剥がして本文を直接読んだもの。要約なし。
- `[要約経由]` — WebFetch/WebSearch の要約を経由したもの。該当箇所に明記。
- `[未到達]` — 試みて失敗したもの: `flake.parts/module-modules`（404、正しいパスは `flake.parts/options/flake-parts-modules.html` と判明し取得し直した）。
- GitHub code/repo search は GitHub 独自のサンプリングインデックスであり網羅的ではない。件数は「採用規模のおおまかな比較」としてのみ扱う。
- 所有者自身のリポジトリ・過去の設計ノートは根拠として使わない（four-lenses ルール通り）。実装は提案しない。

---

## 問い

1. **モジュールシステム＝DI**: options を型付きインターフェース、config を実装、`_module.args`/`specialArgs`/`extraSpecialArgs` を注入、`imports` を合成、`mkDefault`/`mkForce`/`mkOverride` を優先度、`mkIf`/`mkMerge` を条件合成、assertions/warnings を契約として見たとき、vendor と実践者は何を「良い設計」と言い、何を「アンチパターン」と言うか（interface/implementation分離、`specialArgs` 乱用の回避、「options であって引数ではない」、独自 `options` 名前空間をいつ持つか）。落とし穴（config 依存 import からの無限再帰、`specialArgs` の誤用、評価コスト）は何か。
2. **リポジトリレベルのアーキテクチャ**: flake-parts（`flake.modules`含む）、dendritic pattern（vic/mightyiam の dendritic、"aspects/features"）、snowfall-lib、divnix/std（cells/blocks）、haumea/import-tree、ez-configs、digga（撤回済み、既読）、手書き `mkSystem`（mitchellh、既読）、ryan4yin の modules/hosts/home 分割（既読）、Misterio77 の nix-config（既読）。2025〜2026年でどれが採用を伸ばし、どれが放棄されたか。
3. **cross-platform（darwin + 非NixOS Linux の standalone home-manager）**: 実践者は1つのモジュールツリーを nix-darwin と standalone home-manager でどう共有するか、プラットフォーム固有コードはどこに置くか（プラットフォーム別モジュール vs `mkIf isDarwin`）、どんな失敗が起きるか。
4. **テストとCI**: `nix flake check`、macOS/Linux両ランナーでのCI評価、NixOS/home-managerのVMテストや `home-manager build` テスト、nix-unit/namaka によるモジュールテスト、フォーマッタ/リンタ（nixfmt RFC style、statix、deadnix）。誰が使っていて、リグレッションを実際に捕まえた証拠はあるか。
5. **payload と wiring の分離**: サービスコードの中身（LiteLLM の config/compose/スクリプトのような）、TypeScript 製ジェネレータ、symlink される素の設定ファイルのような「Nix でない中身」を、それを配置する Nix モジュール（「どう配備するか」）からどう切り離しているか。

---

## 1. モジュールシステム＝DI（vendor 一次資料 + 実践者）

### 1.1 vendor: `_module.args` は「現在も実装コードにしか書かれておらず、不完全で古い」とドキュメント自身が認めている

`https://nix.dev/tutorials/module-system/deep-dive.html`（`[直接]`）が `pkgs` を注入する例で `config._module.args` を導入した直後、以下の一文が単独の Note として置かれている:

> "This mechanism is currently only documented in the module system code, and that documentation is incomplete and out of date."

これは vendor 自身が「DI コンテナに相当する最重要の注入経路の一つが、実装コード以外にドキュメントを持たない」と認めた一次資料。同じページで `mkIf`・`mkDefault` の優先度も直接確認できる:

> "Module options have a priority, represented as an integer, which determines the precedence for setting the option to a particular value. When merging values, the priority with lowest numeric value wins. The lib.mkDefault modifier sets the priority of its argument value to 1000, the lowest precedence."

### 1.2 vendor: NixOS マニュアルは優先度の全体像（既定100/1500、`mkOverride`/`mkForce`=50/`mkDefault`=1000）と assertions/warnings の正しい書き方を明記

`https://nixos.org/manual/nixos/stable/index.html`（単一ページマニュアル、`[直接]`、HTMLタグ除去後の本文から）:

> "By default, option definitions have priority 100 and option defaults have priority 1500. You can specify an explicit priority by using mkOverride, e.g. `{ services.openssh.enable = mkOverride 10 false; }` This definition causes all other definitions with priorities above 10 to be discarded. The function mkForce is equal to mkOverride 50, and mkDefault is equal to mkOverride 1000."

assertions/warnings は「abort や builtins.trace の代わりに使うべき契約の書き方」として明示的にモデル化されている:

> "Although Nix has the abort and builtins.trace functions to perform such tasks, they are not ideally suited for NixOS modules. Instead of these functions, you can declare your warnings and assertions using the NixOS module system."

具体例（syslogd モジュールからの抜粋、`[直接]`）:

```nix
config = lib.mkIf config.services.syslogd.enable {
  assertions = [
    {
      assertion = !config.services.rsyslogd.enable;
      message = "rsyslogd conflicts with syslogd";
    }
  ];
};
```

### 1.3 vendor: `specialArgs` は「モジュールの不動点を通せない場合の例外」であり、`_module.args` の代替ではなく最終手段と明記されている

同じ単一ページマニュアルの `types.submoduleWith` の項（`[直接]`）:

> "specialArgs An attribute set of extra arguments to be passed to the module functions. **The option `_module.args` should be used instead for most arguments since it allows overriding.** specialArgs should only be used for arguments that can't go through the module fixed-point, because of infinite recursion or other problems. An example is overriding the lib argument, because lib itself is used to define `_module.args`, which makes using `_module.args` to define it impossible."

これは「`specialArgs` を DI コンテナのように何でも詰め込む」設計を vendor 自身が明示的に格下げしている一次資料——`specialArgs` は「fixed point を通せない特殊ケース専用」であり、通常のモジュール間コラボレーションには `_module.args`（オーバーライド可能）を使うべき、という設計指針。

さらに `specialArgs` が `imports` の**静的解決**にしか使えない理由も同じページで直読できる:

> "Whereas option values can generally depend on other option values thanks to laziness, this does not apply to imports, which must be computed statically before anything else. For this reason, callers of the module system can provide specialArgs which are available during import resolution."

### 1.4 vendor: flake-parts は「モジュールを公開するなら `specialArgs` に頼るな」と明記している

`https://flake.parts/module-arguments`（`[直接]`）の `withSystem` の例のコメント行に、この記録にとって最も load-bearing な一文がそのまま書かれている:

> "```nix\nspecialArgs = {\n  packages = config.packages;\n  inherit inputs inputs';\n};\n```\n... Using specialArgs permits use in `imports`. **Note: if you publish modules for reuse, do not rely on specialArgs, but on the flake scope instead.** See also https://flake.parts/define-module-in-separate-file.html"

同じページはモジュール引数の解決メカニズムそのものの制約も明記している:

> "The Nix module system determines which arguments to pass to a module function by using `builtins.functionArgs`. This means only the parameters you explicitly name in your function signature will be available."

これは「`args@{ ... }` パターンは推奨されない」（同ページ、"This works, but is not recommended: ... as the availability of `args` can lead to confusion"）という具体的な書き方の指針にも直結する。

### 1.5 実践者: `specialArgs` を素朴な DI コンテナとして再発明した人物自身が「自分では使っていない」と告白している

`https://tsawyer87.github.io/posts/declarative_depinject/`（2025-05-14、`[直接]`、著者 TSawyer87）は「`specialArgs` は宣言的データフローから逸脱する」と批判した上で、`flake.nix` の `let` ブロック内に自作の `dep-inject` という **独自 options 名前空間** を定義し、それを NixOS/home-manager 双方の `imports` に足すことで `specialArgs`/`extraSpecialArgs` を経由せずに依存性を配る手法を提示する:

> "The Problem with specialArgs ... specialArgs injects values directly into every module's argument list. This approach deviates from NixOS's typical declarative data flow model. ... A Declarative Solution: Injecting via a Custom Option"

```nix
depInject = { pkgs, lib, ... }: {
  options.dep-inject = lib.mkOption {
    type = with lib.types; attrsOf unspecified;
    default = { };
  };
  config.dep-inject = {
    "flake-inputs" = inputs;
    userVars = userVars;
    system = system; host = host; username = username;
  };
};
```

しかし記事末尾の Disclaimer は、この記事全体の結論を弱める、正直な自己申告:

> "**I don't currently personally use this technique in my configuration, it adds complexity that specialArgs aimed to solve.** However, presenting this alternative enhances understanding of different dependency injection methods in Nix Flakes."

**読み方**: 「独自 `options` 名前空間を DI コンテナにする」という設計は技術的に可能で、vendor の `specialArgs` 批判（§1.3〜1.4）とも整合するが、**提案者本人が複雑さを理由に日常使いを見送っている**——「型付きインターフェースとしての独自 options」は正しい方向性だが、無条件に推奨されているわけではない、という釣り合った証拠。

### 1.6 vendor/コミュニティ両方: `imports` が `config` に依存すると無限再帰になる、という契約はドキュメントと実例の双方で一致

NixOS Discourse の一次スレッド `https://discourse.nixos.org/t/infinite-recursion-when-importing-a-dynamically-generated-list-of-modules-based-on-config/52616`（`[直接]`、2024-09-24、質問者 gaelj、回答者 waffle8946）:

> "Of course, imports cannot depend on config since config already depends on imports."

回答は「`attrsOf submodule` を使う」ことで解決している。この設計上の理由（`imports` は静的解決フェーズにあり、`config` は遅延評価フェーズにある）は §1.3 で見た vendor 一次資料の `specialArgs`/import 解決の記述と完全に一致する。実践者向けの `specialArgs` パターン解説記事（`https://wobcom.github.io/fernglas/unstable/appendix/nixos-specialArgs-pattern.html`、`[直接]`）も同じ理由を独立に述べている:

> "specialArgs also means that in contrast to `_module.args` this parameter to the module system is fixed, and can not be changed by nixos modules themselves. this prevents infinite recursions when using stuff from the inputs attrset in nixos module imports (which is exactly what we want to do)."

### 1.7 vendor/コミュニティ両方: 「options は外部インターフェースの宣言である」という言葉そのものが、NixOS Wiki に明記されている

`https://wiki.nixos.org/wiki/NixOS_modules`（`[直接]`）の "Option Declarations" 節:

> "**Declarations specify a module's external interfaces.**"

これはこの記録の DI 枠組み（options=インターフェース、config=実装）を、設問者側の比喩ではなく wiki（コミュニティ運営、vendor 隣接）の一次語彙として裏付ける、最も直接的な一文。

---

## 2. リポジトリレベルのアーキテクチャ（実践者 + 実態）

### 2.1 flake-parts: `flake.modules` は「クラス別の型チェック」を持つが、オプトインの別モジュールであり、コア機能ではない

`https://flake.parts/options/flake-parts-modules.html`（`[直接]`）:

> "This module provides a generic modules flake output attribute, that can host modules for any module system application. Furthermore, **it adds basic type checking so that the modules can't be imported into the wrong class of configurations.** For example, if a Home Manager module would be loaded into a NixOS configuration, that becomes a simple type error, instead of a complicated message about undeclared options."

インストールは明示的なオプトイン:

> "To use these options, add inside the mkFlake: `imports = [ inputs.flake-parts.flakeModules.modules ];` Run `nix flake lock` and you're set."

`hercules-ci/flake-parts` 自体は 1,475★、pushed 2026-09-03（`[直接]`、`api.github.com/repos/hercules-ci/flake-parts`）——活発。

### 2.2 dendritic pattern: 「すべてのファイルがモジュール」という設計思想の正確な一次資料と、その発祥地の実態

`https://raw.githubusercontent.com/mightyiam/dendritic/main/README.md`（`[直接]`、リポジトリ `mightyiam/dendritic`、**634★**、pushed 2026-09-04）:

> "In the dendritic pattern each and every Nix file is a module of the top-level configuration. ... Each and every Nix file also - implements a single feature - ...across all configurations that that feature applies to - is at a path that serves to name that feature."

注意点: 検索で先にヒットした `vic/dendritic`（0★、pushed 2026-02-27、ほぼ同一の description）は**同名だが無関係の低star リポジトリ**であり、正典は `mightyiam/dendritic`——名前の取り違えに注意（同じ著者 mightyiam が GitHub 上で `vic` と `mightyiam` の2アカウントを持っている可能性もあるが、確認できたのはユーザーID 635591=mightyiam と別ID=vic であり、star数と活動から見て `mightyiam/dendritic` を canonical として扱う）。

**発祥地 `mightyiam/infra`**（205★、pushed 2026-09-24=当日、`[直接]`、`api.github.com/repos/mightyiam/infra`）の README（`[直接]`）:

> "This repository follows the dendritic pattern and happens to be the place in which it was discovered by its author." / "Nix files (they're all flake-parts modules) are automatically imported. Nix files prefixed with an underscore are ignored. No literal path imports are used."

同 README のテスト関連の一次記述（Q4 にも該当）:

> "To help determine whether a Nix change results in changes to derivations, a package `.#all-check-store-paths` builds a TOML file that maps from `.#checks`" / `nixConfig.abort-on-warn = true;`

**重要な欠落**: `mightyiam/infra` の `modules/computers/` は全ホストが `*.facter.json`（nixos-facter によるハードウェア検出）を伴う **NixOS 専用マシン**であり、`darwinConfigurations` への言及はコード検索で 0 件（`https://api.github.com/search/code?q=darwinSystem+repo:mightyiam/infra`、`[直接]`、`total_count: 0`）。**dendritic パターンの発祥地そのものは、この所有者が必要とする macOS+cross-platform の実例を一つも示していない。**

`import-tree` は `vic/import-tree` から `denful/import-tree`（**337★**、pushed 2026-09-03、`[直接]`）へ実質的に移管されており、README（`[直接]`）:

> "🌳 Works with NixOS, nix-darwin, home-manager, flake-parts, NixVim, etc." / "🌿 Built to enable the Dendritic Pattern on both stable/unstable Nix."

### 2.3 dendritic + darwin の実例規模: 小さいが実在し、独自 options 名前空間パターンを実際に使っている

GitHub code search（`[直接]`、`q="dendritic" "darwinConfigurations" extension:nix"`）は **40件**ヒット。その中の `kriswill/dotfiles`（**39★**、pushed 2026-09-24=当日、`[直接]`）の `modules/darwin.nix`（`[直接]`）は、§1.5 の「独自 options 名前空間」パターンを実際に実装している一次コード:

```nix
options.configurations.darwin = lib.mkOption {
  type = lib.types.lazyAttrsOf (
    lib.types.submodule {
      options.module = lib.mkOption { type = lib.types.deferredModule; };
    }
  );
  default = { };
  description = "nix-darwin configurations, keyed by hostname.";
};

config.flake.darwinConfigurations = lib.flip lib.mapAttrs config.configurations.darwin (
  _name: { module }:
  inputs.darwin.lib.darwinSystem {
    specialArgs = { inherit inputs; inherit (inputs) self; outputs = inputs.self; lib = extendedLib; };
    modules = [ module ];
  }
);
```

コード先頭のコメントには "Adapted from the mightyiam/dendritic example `nixos.nix`." とあり、**dendritic 発祥地が darwin 版を持たないため、実践者が自力で NixOS 版から移植したことが明記されている**。ただしこのリポジトリも standalone home-manager（非NixOS Linux）は持っていない（`modules/` に `homeManagerConfiguration` の記述なし、`[直接]` コード検索 `total_count: 0`）——nix-darwin + NixOS の組み合わせであり、この所有者の「darwin + standalone home-manager」とは異なる。

より大規模な例: `kclejeune/system`（**531★**、pushed 2026-09-23、description "Declarative system configurations using nixOS, nix-darwin, and home-manager"、`[直接]`）は `darwinConfigurations` を含むことをコード検索で確認済み——dendritic系譜の中で最も採用規模の大きい、darwin を含む実例。

### 2.4 snowfall-lib: vendor 自身の README が「実質的に長らくメンテされていない」と明言している

`https://raw.githubusercontent.com/snowfallorg/lib/main/README.md`（`[直接]`）冒頭:

> "# Call For Maintainers 📣 Hello! Originally developed by Jake Hamilton, **Snowfall Lib has been effectively unmaintained for some time now.** If you still use Snowfall Lib and would like to take over maintenance of the project, please get in touch using the Discussion page."

repo自体は 628★、pushed 2026-07-17（`[直接]`）——直近pushが2ヶ月前と「生きている」ように見えるが、**その push はこの「メンテナ募集」告知自体である可能性が高く、機能開発ではない**。「convention-based directory」型（`systems/`, `homes/`, `modules/` を規約で自動発見）の代表例だが、vendor 自身の言葉で撤退表明されている——digga（既読、撤回済み）に続く2件目の「共有ライブラリとして一次機能化する試みが撤退した」実例。

### 2.5 divnix/std: 1年以上停止、54件のopen issue

`https://api.github.com/repos/divnix/std`（`[直接]`）: 484★、**pushed 2025-08-25**（本記録時点で13ヶ月超停止）、archived: false、open_issues: **54**。"cells/blocks" という独自語彙（Modules/Profiles/Suites より抽象度が高い、DevOpsライフサイクル全体を扱うフレームワーク）は既読記録の digga と同種の「共有ライブラリとして一次機能化する試み」であり、活動が止まっている点で同じ結末をたどりつつある。

### 2.6 ez-configs: 最小の採用規模、15ヶ月停止のオリジナルと0star のフォーク

`ehllie/ez-configs`（`[直接]`）: 91★、pushed **2025-06-17**（15ヶ月超停止）。README（`[直接]`）:

> "This module allows for defining configuration and module outputs in your flake, for use in nixos, nix-darwin and home-manager, using your directory structure." "This results in 6 directories the module can use: nixosModules / nixosConfigurations / darwinModules / darwinConfigurations / homeModules / homeConfigurations"

**この所有者が求める「nixos/darwin/home-manager の3クラスを規約ベースのディレクトリで扱う」機能を最も直接的に持つツールだが、採用規模は今回調べた中で最小級かつ15ヶ月停止。** フォーク `Managarmrr/ez-configs` は0★・pushed 2024-07-16でさらに停止が長い。

### 2.7 haumea/namaka/nix-unit: メンテナ体制が明記された小規模だが現役のツール群

`nix-community/haumea`（`[直接]`）: 419★、pushed 2026-09-08、description に "[maintainer=@figsoda]" と個人メンテナ名が明記——nix-community 組織の慣習として、各リポジトリのメンテナが README/descriptionレベルで可視化されている（snowfall-lib の「メンテナ募集」告知と対照的）。`nix-community/namaka`（145★、pushed 2026-09-06、"[maintainer=@figsoda]"）、`nix-community/nix-unit`（142★、pushed 2026-09-18、"[maintainer=@adisbladis]"）。

### 2.8 採用規模の比較表（GitHub code search、2026-09-24時点、`[直接]`）

| クエリ | 件数 |
|---|---|
| `treefmt-nix` in `flake.nix` | 6,176 |
| `statix` + `deadnix` + `nixfmt` 同一 `flake.nix` 内 | 1,162 |
| `nix-unit` in `flake.nix` | 150 |
| `import-tree` + `homeManagerConfiguration` | 54 |
| `dendritic` + `darwinConfigurations` | 40 |
| `namaka` in `flake.nix` | 27 |
| `darwinSystem` in `mightyiam/infra`（dendritic発祥地） | 0 |

フォーマッタ/リンタ（treefmt-nix経由の統合）は、モジュール単体テスト（nix-unit/namaka）より一桁以上大きい採用規模——「フォーマットは当たり前、テストはニッチ」という業界の重心が数値で見える。

---

## 3. Cross-platform（darwin + standalone home-manager）の実装詳細

### 3.1 「The One Nix」: この所有者と一字一句一致する三方向分岐の詳細設計（ただし低採用の個人プロジェクト）

`https://frankper.gitlab.io/the-one-nix/project-info/module-load-architecture/`（`[直接]`、GitLab上のプロジェクト、`https://gitlab.com/frankper/the-one-nix`、GitLab API で確認: star_count **1**、作成 2026-03-06、last_activity 2026-09-23=前日、`[直接]`）は、NixOS/darwin/standalone home-manager の三方向分岐を1つの `home/shared/` ツリーから構築する、この所有者の形にほぼそのまま一致する設計を持つ:

> "The repo builds three distinct host classes from one shared `home/shared/` tree ... NixOS — built by `lib/mkHost.nix`. Loads `modules/nixos/*` system-side plus `home/shared/*` via home-manager. Darwin (nix-darwin) — built by `lib/mkDarwin.nix`. Loads `modules/darwin/*` system-side plus `home/shared/*` via home-manager. **Standalone home-manager** — built by `lib/mkHome.nix`. Loads ONLY `home/shared/*` (no system layer; the user runs HM on a non-NixOS Linux or macOS host without nix-darwin)."

プラットフォーム分岐は名前つきの2軸で構造化されている:

> "Two orthogonal gating axes decide whether a given HM module activates a code path: `hmContext` A string special-arg threaded into HM (`"nixos"` / `"darwin"` / `"standalone"`) ... `pkgs.stdenv.isLinux` / `.isDarwin` Runtime platform check on the pkgs set ... A third axis — the platform tag in `lib/settings-reference.nix` (`any` / `linux` / `darwin`) — **is not runtime gating**; it tells scripts/check-settings.sh which settings keys a given host class must declare."

standalone 固有の分岐の具体例（`[直接]`）:

> "`home/shared/shell/zsh.nix:12` `hmContext == "standalone"` Strips fzf-tab's prebuilt native module (Nix `.so` RPATH can't resolve a foreign distro's glibc → `GLIBC_ABI_DT_X86_64_PLT`), falling back to pure-zsh. NixOS/darwin keep the fast native module." / "`rio.nix:15`, `wezterm.nix:9`, `alacritty.nix:14`, ... `if hmContext == "standalone" && isLinux then (nixGL-wrap …) else …` Wraps the terminal in `config.lib.nixGL.wrap` for GPU access on non-NixOS Linux; NixOS/darwin use the raw `pkgs` derivation."

**評価**: これはこの所有者の要件に対して**最も詳細に一致する設計**だが、GitLab star 1・fork 1 という、ほぼ観測されていない個人プロジェクト。「業界の合意」としては扱えず、「一人の実践者が到達した、詳細に文書化された一設計」として重みづけする。`hmContext` という文字列 `specialArgs` は §1.3〜1.6 の vendor ガイダンス（`specialArgs` は import 解決に必要な最小限の情報のみに使うべき）とも整合的——プラットフォーム種別という、まさに import 前に必要な静的情報を運んでいる点で、vendor の推奨用途の範囲内にある。

### 3.2 britter.dev: cross-platform standalone home-manager を実際に運用していた実践者による、2026年最新の移行記録（進行中、結論未確定）

`https://britter.dev/blog/2026/05/11/exploring-the-dendritic-nix-pattern/`（2026-05-11、`[直接]`、著者 Benedikt Ritter）は、この所有者に最も近い実体験を持つ一次資料: 著者は「デスクトップ、複数のホームサーバー、Raspberry Pi、**Fedora の仕事用ノートPC上の standalone home-manager**」を1つの role ベースの module ツリーで運用しており、dendritic パターンへの移行を検討中に自分の現行設計の欠陥を書き出している。

**cross-platform 固有の痛点（`osConfig`）**:

> "The first is the `osConfig` argument. When home-manager runs as a NixOS module, it gives home-manager modules read access to the NixOS configuration through this argument. ... In standalone mode, though, there is no NixOS layer, so there is no real `osConfig`. Home-manager sets it to an empty attribute set. To keep the same modules working on Fedora, I pass a fake struct via `extraSpecialArgs`: ... **It works, but it's obviously a hack. The standalone configuration pretends to have a NixOS layer that doesn't exist.**"

**カスタムパッケージのオーバーレイも standalone では手動配線が必要**:

> "In the standalone home-manager configuration there is no NixOS layer to apply that overlay, so I have to wire them in manually as an inline anonymous module ... Every time I add a new custom package I have to remember to wire it here too."

**macOS(nix-darwin) との過去の経験も同じ構造的問題として振り返っている**（この所有者に最も直接関係する一節）:

> "At a previous employer I used macOS, which meant a nix-darwin configuration alongside the NixOS one, with a parallel `modules/darwin/` directory and a `home/profiles/` system to switch between work and personal identities. When I decommissioned that MacBook the parallel hierarchy went away, but the underlying problem didn't: **any machine that doesn't fit the dominant assumption of "NixOS with my personal home configuration" needs a different shape, and the central wiring fights you every time.**"

dendritic パターンへの移行で、この `osConfig` ハックが具体的にどう解消される予定かも明記されている:

> "And the kind of mess I described in the Fedora setup goes away even if I never migrate that machine to NixOS. The standalone home-manager configuration becomes a host aspect like any other. **The `osConfig` mock is replaced with a let binding that both NixOS and standalone contexts close over.**"

**重要な留保**: この記事は移行の**計画段階**の記録であり（"I'll write a follow-up post once the migration is complete" — 本記録時点でフォローアップは未確認）、実際に移行が成功したかどうかの検証は済んでいない。既読記録の Ben Mezger（macOS で Nix を断念）と対照的に、こちらは「移行を試みている最中」の一次資料として扱う。

---

## 4. テストとCI

### 4.1 vendor: `nix flake check` の公式チェック対象リストに `darwinConfigurations` は含まれない

`https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake-check.html`（Nix 2.28.8 リファレンスマニュアル、`[直接]`）が列挙する「評価されるべき flake output attribute」のリストには以下が含まれる:

> "The following flake output attributes must be derivations: `checks.<system>.<name>`, `defaultPackage.<system>`, `devShell.<system>`, `devShells.<system>.<name>`, **`nixosConfigurations.<name>.config.system.build.toplevel`**, `packages.<system>.<name>`"

**`darwinConfigurations` はこのリストに存在しない。** `nixosConfigurations` だけが明示的にチェック対象として列挙されており、`darwinConfigurations`/`homeConfigurations` を `nix flake check` にカバーさせるには、実践者が自分で `flake.checks` に手動配線する必要がある——これは§2.2 で見た `mightyiam/infra` の `all-check-store-paths`（"a package `.#all-check-store-paths` builds a TOML file that maps from `.#checks`"）や §2.3 の `kriswill/dotfiles` の `modules/darwin.nix`（`config.flake.checks = lib.mkMerge (... "configurations:darwin:${name}" = cfg.config.system.build.toplevel; ...)`）が、まさにこの vendor 側の欠落を埋めるための一次コードだったと分かる。

### 4.2 実践者: `nix flake check` を「意図的に使わない」という、コスト由来の具体的なCI設計判断

`https://raw.githubusercontent.com/kriswill/dotfiles/main/.github/workflows/ci.yml`（`[直接]`）冒頭のコメント:

> "Build gate: the two host closures this repo actually deploys — k (aarch64-darwin, on the arm64 macOS runner; free on public repos) and nebula's NixOS toplevel (x86_64-linux). **Deliberately NOT `nix flake check`: the darwin checks would build all three darwin hosts; the gate is k only.**"

実際のジョブ定義（`[直接]`）は macOS ランナーと Linux ランナーを明示的に使い分けている:

```yaml
darwin-k:
  runs-on: macos-latest # arm64 == aarch64-darwin, matches host k
  timeout-minutes: 120
  steps:
    - uses: DeterminateSystems/determinate-nix-action@v3
    - uses: DeterminateSystems/flakehub-cache-action@main
    - run: nix build .#darwinConfigurations.k.system -L

nixos-nebula:
  runs-on: ubuntu-latest
```

`timeout-minutes: 120` という数字自体が、ホストのシステムクロージャ全体をビルドするCIがどれだけ長時間になり得るかを示す一次データ。さらに、ビルド不要な変更で毎回フルビルドが走らないよう、**マージコミットのツリーが既にビルド済みのPRヘッドと同一かを比較して重複ビルドをスキップする "gate" ジョブ**を自作している（`[直接]`、同ファイル）:

```yaml
gate:
  runs-on: ubuntu-latest
  steps:
    - run: |
        if [ "${{ github.event_name }}" = "push" ] && git rev-parse -q --verify 'HEAD^2' >/dev/null &&
           [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'HEAD^2^{tree}')" ]; then
          echo "build=false" >> "$GITHUB_OUTPUT"
        else
          echo "build=true" >> "$GITHUB_OUTPUT"
        fi
```

**読み方**: 「macOS+Linuxの2ランナーCI」という既読記録（dotfiles-architecture.md §2.6）が確認した非Nixの一般原則は、Nix固有の文脈でも成立するが、**Nixの場合は「クロージャ全体を毎回ビルドするコスト」という固有の問題が上乗せされ、`nix flake check` をそのまま使わず自前でスコープを絞る、という具体的な回避策が実践者コミュニティで生まれている**——vendor機能をそのまま使うのではなく、その上に薄いコスト管理層を自作する必要がある、という点は「摩擦が消えるわけではない」という既読の steelman 記録の結論とも一致する。

### 4.3 モジュール単体テストのツール比較（vendorに近い一次資料）

`https://raw.githubusercontent.com/nix-community/nix-unit/main/README.md`（`[直接]`）の比較表は Tweag のブログ記事 "Unit test your Nix code" を出典として明記している:

> "This comparison matrix was originally taken from Unit test your Nix code (https://www.tweag.io/blog/2022-09-01-unit-test-your-nix-code/) but has been adapted. Pythonix is excluded as it's unmaintained."

| Tool | Can test eval failures | in nixpkgs | snapshot testing |
|---|---|---|---|
| Nix-unit | yes | yes | no |
| runTests | no | yes | no |
| Namaka | no | yes | **yes** |

`nix-community/namaka`（145★、pushed 2026-09-06、`[直接]`）README:

> "Snapshot testing for Nix based on haumea" / "`load` — Wrapper around `haumea.load` to load snapshot tests from a directory."

**両ツールとも「Nix式（関数・値）の単体テスト」であり、「NixOSシステム全体のVM統合テスト」ではない**——後者（NixOS testing framework、既読 nixosmod.txt にも `nixosTest`/`extendNixOS` の記述あり）はより重量級で、個人 dotfiles での採用実例は今回の調査でも見つからなかった（前例なしリストに追加）。

### 4.4 フォーマッタ/リンタの vendor 位置づけと採用規模

`NixOS/nixfmt`（1,611★、pushed 2026-09-22、`[直接]`、description "The official formatter for Nix code"）——nixpkgs RFC 166 のフォーマットを実装する「公式」フォーマッタ。`oppiliappan/statix`（948★、pushed 2026-07-26、"lints and suggestions for the nix programming language"）、`astro/deadnix`（784★、pushed 2026-09-05、"Scan Nix files for dead code"）、`numtide/treefmt-nix`（652★、pushed 2026-08-16）——いずれも活発。§2.8 の採用規模比較表の通り、`treefmt-nix` 経由の統合（6,176件）は、モジュール単体テストツールより一桁以上普及している。

---

## 5. payload と wiring の分離

### 5.1 britter.dev: 「.nix でないファイルは import-tree に無視させ、Nixモジュールと同じディレクトリに同居させる」という具体的な一次パターン

§3.2 で引用した britter.dev の記事は、secrets ファイルの配置について payload/wiring 分離の一次実例を示している（`[直接]`）:

> "The secretsFile itself sits next to the host's `default.nix` in `modules/hosts/<host>/`. **It isn't a `.nix` file, so import-tree ignores it**; everything for the host stays in one directory."

同記事はハードウェア固有の生成ファイル（`nixos-generate-config` の出力）についても同種の分離を明記している:

> "Hardware-specific files that genuinely belong to one machine, like a nixos-generate-config output, live outside `modules/` in a separate `machines/` directory and are imported by path from the host aspect."

そして dendritic パターン自体の技術的制約として、**「.nix ファイルは自動的にモジュールとして評価される」という import-tree の挙動が、逆に「.nix ではない payload」を同じツリーに置くことを強制する**という副作用も脚注で述べている:

> "import-tree recursively imports every `.nix` file under `modules/` as a flake-parts module, so plain NixOS modules can't live there or they'd cause evaluation errors."

**読み方**: 「Nix でない payload（YAML/生成ファイル/バイナリ設定）は、それを配置する Nix モジュールと同じディレクトリに物理的に同居させつつ、拡張子または `import-tree` の無視規則（`/_` プレフィックス、非 `.nix` 拡張子）によって評価対象から除外する」という、この所有者が求める「payload と wiring の分離」に対する、具体的で再現可能な一次パターンがここにある。

### 5.2 §1.5 の `dep-inject` パターンの逆読み: 「値そのもの」（payload/データ）と「注入の配線」（wiring）の分離

§1.5 で見た `dep-inject` パターンも、別の角度から見れば payload/wiring 分離の一種——`userVars`（ユーザー固有の値=payload）と、それを各モジュールに届ける `options.dep-inject` の宣言（wiring）が明確に分離されている。ただし著者自身がこれを「複雑さが増す」と評価している点（§1.5 の Disclaimer）は、この分離のコストが無料ではないことを示す。

### 5.3 既読記録との接続: `mkOutOfStoreSymlink` そのものが「Nix ストアという payload の場所」と「実行時に外部ツールが書き込む実体」を分離する vendor 機構である

既読 `2026-09-24-role-based-dotfiles.md` §1.6・既読 `2026-09-24-steelman-nix.md` §2 が既に直読・引用済みの `mkOutOfStoreSymlink`（`skippednote/dotfiles` の "Out-of-store symlinks — six managed files are written by the tools that read them ... Store copies are read-only and would break all six" を含む）は、まさに「Nix wiring が指す先」と「実行時に書き換わる payload」を分離する vendor 機構そのもの——本記録はこの機構を再調査しないが、Q5（payload/wiring 分離）の文脈でも同じ機構が答えの一部であることを明記しておく。

---

## 代表構成のツリー（本記録で新規取得したもののみ）

**mightyiam/infra**（dendritic発祥地、205★、NixOS専用・darwin無し）:
```
flake.nix          ← 自動生成（denful/flake-fileで各モジュールから合成）
outputs.nix
modules/
  computers/        ← *.nix + *.facter.json（ホスト、全てNixOS）
  home-manager.nix / nixos.nix / eval-modules.nix / lib.nix
  <feature>.nix, <feature>/ ...（自動import、アンダースコア接頭辞は無視）
```

**kriswill/dotfiles**（39★、dendritic + darwin+NixOS、standalone HM無し）:
```
flake.nix           ← flake-parts.lib.mkFlake (import-tree ./modules)
modules/
  darwin.nix         ← options.configurations.darwin（独自名前空間）+ flake.darwinConfigurations 実現 + flake.checks配線
  nixos.nix
  darwin/ , nixos/ , hosts/
.github/workflows/
  ci.yml             ← macos-latest(darwin-k) + ubuntu-latest(nixos-nebula)、nix flake check不使用、gateジョブで重複ビルド回避
```

**frankper/the-one-nix**（GitLab、star 1、NixOS+darwin+standalone HMの三分岐、詳細だが低採用）:
```
lib/mkHost.nix      ← NixOS, hmContext="nixos"
lib/mkDarwin.nix    ← nix-darwin, hmContext="darwin"
lib/mkHome.nix      ← standalone home-manager, hmContext="standalone"（システム層なし）
modules/nixos/      （29モジュール、NixOS専用）
modules/darwin/     （32モジュール、Darwin専用）
home/shared/        （18モジュール、全ホストクラスが読む）
```

**ez-configs 規約**（91★、15ヶ月停止）: `nixosModules/`, `nixosConfigurations/`, `darwinModules/`, `darwinConfigurations/`, `homeModules/`, `homeConfigurations/` の6ディレクトリを規約で自動発見。

---

## 否定側の証拠（意図的に同じ熱量で収集）

- **snowfall-lib は vendor README 自身が「実質的にメンテされていない」と告知** — "Snowfall Lib has been effectively unmaintained for some time now." 628★という中規模採用がありながら、公式の後継者募集状態。
- **divnix/std は13ヶ月停止、54件のopen issue** — "cells/blocks" という独自語彙で共有ライブラリ化を試みた2件目（1件目は既読の digga）。どちらも同じ結末（撤退/停滞）をたどっている。
- **ez-configs は最も直接的にこの所有者の要件（nixos/darwin/home-manager 3クラスの規約ベース発見）に一致するツールだが、15ヶ月停止し採用規模も最小級**（91★、フォークは0★）。
- **dendritic パターンの発祥地自体が darwin を一つも実演していない** — `mightyiam/infra` に `darwinConfigurations` は0件。この所有者に最も近い実装（`kriswill/dotfiles`）は自力で移植したと明記している。
- **`nix flake check` は vendor の公式チェック対象リストから `darwinConfigurations` を欠いている** — NixOSだけが一次機能としてカバーされ、darwin/home-managerは実践者が自分で `flake.checks` に配線する必要がある。
- **実践者は `nix flake check` を「コストが高すぎる」という理由で意図的に使わないことがある** — kriswill/dotfiles の一次コメント "Deliberately NOT `nix flake check`: the darwin checks would build all three darwin hosts" は、vendor機能をそのまま使わない具体的な理由を示す。
- **`specialArgs` を DI コンテナとして再発明した提案者自身が、複雑さを理由に自分では使っていないと告白** — tsawyer87.github.io の Disclaimer。
- **standalone home-manager での cross-platform 運用は、macOSでも実際に「central wiring が壊れる」と経験した実践者が、Fedoraでも同じ問題（`osConfig` の空セット問題）に直面し、記事執筆時点でも移行未完了** — britter.dev、2026-05-11、フォローアップ記事は本記録時点で確認できず。
- **`_module.args` という DI の中核メカニズムの一つが、vendorドキュメント自身によって「不完全で古い」と評されている** — nix.dev deep-dive の Note。

---

## 確認できなかったこと（前例なし）

- macOS(nix-darwin) + 実機の非NixOS Linux(standalone home-manager) を、dendritic パターンで実際に運用し「移行完了」まで漕ぎ着けた実例——britter.dev は計画〜移行中の記録のみで、フォローアップ記事は本記録時点で見つからなかった。既読記録の sanketsudake（dendritic不使用、`mkDarwinHost`/`mkHomeHost` 2関数の素朴な形）が今も唯一の「完了済み」完全一致例。
- NixOS/home-manager の VM統合テスト（`nixosTest`）を個人の1〜2台規模 dotfiles で実際に採用している実例——今回の検索でも見つからなかった。
- `nix-unit`/`namaka` によるモジュール単体テストを、この所有者と同規模（1〜2台の個人機）のリポジトリで実際に運用している一次資料——採用規模の数値（150件/27件のコード検索ヒット）はあるが、個別の運用実感を書いた practitioner のブログ記事は見つからなかった。
- 「独自の `options` 名前空間を DI コンテナとして使う」設計を、日常的に使い続けていると明言する実践者の一次資料——見つかった唯一の直接的提案者（tsawyer87）は「自分では使っていない」と述べており、正の一次資料としては使えない。
- dendritic パターンの評価コスト（`import-tree` が全ファイルを毎回スキャンする際の `nix eval` 時間）を実測した一次資料——検索は試みたが、具体的なベンチマーク数値を持つ記事は見つからなかった。

---

## 結論

**この形（macOS 1台 + Linux 1台、home-manager standalone、所有者1人）にとって、業界の受容された実践と、過剰設計の境界はどこにあるか。**

**モジュールシステム＝DIという捉え方自体は、vendor一次資料に裏付けられている。** options=インターフェース（"Declarations specify a module's external interfaces."、wiki.nixos.org）、`_module.args`=オーバーライド可能な注入（vendorが「`specialArgs`より優先して使うべき」と明記）、`specialArgs`=不動点を通せない場合の最終手段（NixOSマニュアル一次資料、flake-partsも同じ立場）、`mkOverride`/`mkForce`/`mkDefault`=優先度（100/1500既定、50/1000）、assertions/warnings=契約——これらはすべて vendor ドキュメントの一次記述と一致する。**支持されない**のは「独自の `options` 名前空間を汎用DIコンテナとして常用する」という発展形——技術的には動くが、提案者本人が「複雑さが増す」と述べて自分では使っていない。

**リポジトリレベルのアーキテクチャは、共有ライブラリ化の方向に進むほど撤退率が上がる、という既読記録の傾向が今回も繰り返し確認された。** digga（既読、撤回）に続き、snowfall-lib（vendor自身が「メンテ募集」）、divnix/std（13ヶ月停止、54issue）、ez-configs（15ヶ月停止、最小採用）と、**「共通ライブラリとして flake を組み立てる」という発想のツールは、調べた4つのうち4つとも停滞または撤退している。** 対して flake-parts 自体（コアのモジュール合成機構、1,475★、活発）と、その上に薄く乗る `import-tree`/dendritic パターン（634★、当日push、複数の独立した実装例が今も増え続けている）は健在。**この所有者の規模には、flake-parts の素のモジュール合成 + 必要なら `import-tree` という薄い層までが業界の生きた実践であり、snowfall-lib/std/ez-configsのような規約ベースのフレームワーク全体を採用する根拠は、今回の証拠からは出てこない。**

**cross-platform（darwin + standalone home-manager）の実装詳細は、既読記録（sanketsudake）よりも詳しい実例が今回2件見つかったが、どちらも重みは軽い。** frankper/the-one-nix はこの所有者の形に驚くほど詳細に一致する設計（`hmContext` 特殊引数、`stdenv.is*` ランタイムチェック、非ランタイムのスキーマタグという3軸の使い分け）を持つが、GitLab star **1** という、ほぼ観測されていない個人プロジェクト。britter.dev は最も信頼できる一次証言（実際にstandalone home-managerを運用してきた実践者の、2026年最新の記事）だが、**移行は執筆時点で未完了**であり、`osConfig` の空セット問題という具体的な技術的痛点を報告している——この所有者が同じ構成を組む場合に直面する可能性が高い問題として、名前つきで記録しておく価値がある。

**テスト/CIについては、vendorの `nix flake check` に darwin が入っていないという欠落が、実践者に「自分でchecksを配線する」か「flake checkを使わずに手動でビルド対象を絞る」かの二択を強いている、という具体的な構造が今回初めて明らかになった。** `kriswill/dotfiles` の "Deliberately NOT `nix flake check`" は、コスト管理の観点からの合理的な判断であり、この所有者にも同じ設計判断が必要になる可能性が高い。フォーマッタ統合（treefmt-nix、6,176件）とモジュール単体テスト（nix-unit/namaka、150/27件）の採用規模の差は一桁以上——**フォーマッタ統合は「当然やること」、モジュール単体テストは「まだニッチ」というのが、今回の数値が支持する実態。**

**payload/wiring 分離は、britter.dev の「`.nix` でないファイルは import-tree に無視させつつ同じディレクトリに同居させる」パターンが、最も具体的で再現可能な一次実例。** 既読記録の `mkOutOfStoreSymlink` と合わせて、「Nixが配置の宣言を持ち、中身は実行時に外部が書く/読む」という一貫した設計思想が、複数の独立した実例（secrets ファイル、生成されたハードウェア設定、編集可能な dotfiles）で繰り返し確認できる。

**過剰設計だと判断できる境界**: (a) snowfall-lib/divnix-std/ez-configs のような、規約ベースの汎用フレームワーク全体を依存として採用すること——3件とも活動停滞という同じ結末をたどっており、この所有者の1〜2台規模には見合わない。(b) `specialArgs` の代替としての汎用DIコンテナ（`dep-inject` パターン）を常用すること——提案者自身が過剰と判断している。(c) NixOS VM統合テスト（`nixosTest`）——個人規模での採用実例が見つからず、`nix flake check` のコスト問題（§4.2）を考えると、まず解決すべきはビルド対象の絞り込みであって、より重いテスト層の追加ではない。


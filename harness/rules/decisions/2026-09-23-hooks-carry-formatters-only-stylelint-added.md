# jigのフックが自前で回すのは整形と型検査だけ、例外は設定のあるstylelint、他の検査は許可リストと指示文で

Status: accepted — staticcheck / clippy / race / html-validateの自動フック配線は業界で少数かつ低star、ベンダー自身がCI向けと位置付け、stylelintだけPostToolUseへの実配線が二桁ある（2026-09-23）

rule: jig's own hook tables run formatters on edit and type-check/lint gates at Stop, nothing else; the one addition is stylelint on edit for .css/.scss/.sass/.less when the project has a stylelint config (config or silence). Never wire staticcheck, cargo clippy, go test -race or html-validate into hooks; make them runnable through guard permits and tell the model in AGENTS.md to run the language's static checks before claiming completion. Let rustfmt read the project's edition instead of hard-coding one.
scope: repo

## Problem

退役したyokiのフックは、整形と型検査のほかに「編集ごとの`go vet` + `staticcheck`」「strict時の`go test -race`」「編集ごとの`ruff check`」「eslint / oxlintの段」「stylelintとhtml-validate」を持っていた。jigの対応表（プロジェクトが手順を持たないときの既定）にそれらを足すか、足すなら編集ごとかStopか。

## Decision

- **足すのはstylelintだけ。** `.css .scss .sass .less`の編集ごと、プロジェクトにstylelintの設定があるときに限る。設定が無ければ何もしない（設定か沈黙か）。
- **staticcheck、cargo clippy、`go test -race`、html-validateはフックに入れない。** 走らせられるようにguardのpermitに入れ（`policy/guard-rules.json`、持ち主が貼る）、`rules/common`の一行で「完了を言う前にその言語の静的検査（Go: staticcheck、Rust: clippy）を回す」と教える。プロジェクトが手順を持つならそちらが走る（前の裁定）。
- 編集ごとの`ruff check`は足さない。lintはStopの`ruff check .`に一本化。
- rustfmtの`--edition 2021`決め打ちをやめ、rustfmtに`rustfmt.toml` / `Cargo.toml`のeditionを読ませる。

## Alternatives considered

- **Stopゲートでstaticcheck / clippyを強制する**: 確実に走るが、実配線は少数（staticcheck + Stop実配線13件、検証できたのは0★ と13★）、clippyはビルド一回分の待ちが毎ターン乗る。静的検査をどこかで走らせるという要件は、プロジェクトの手順・CI・許可リスト + 指示文の三つで満たされ、フックだけが置き場ではない。却下。
- **`jig init hooks`でlefthook.ymlの雛形を配る**: gitフックはプロジェクト側の道具で、ハーネスの領分ではない。jigがプロジェクトにファイルを作る経路を持たない方が、仕事のリポジトリでも安全。却下。
- **raceを無人実行だけ回す**: 分岐が増える割に、無人実行の成功条件はgoal側で機械的に決める（loop-native-goalの裁定）ので、そこに`go test -race`を書けば足りる。却下。

## Consequences

- `format.ts`にstylelintの項を足す（設定検出: `.stylelintrc*` / `stylelint.config.*` / `package.json`の`stylelint`キー）。`.scss .sass .less`はstylelintの項だけに載り、biome / prettierの表には載せない。
- guardのpermit断片（staticcheck、cargo clippy、go test、stylelint、html-validate）をdry-runが印字し、持ち主が`policy/guard-rules.json`に貼る。
- `rules/common/50-quality-and-testing.md`に一行: 完了を言う前にその言語の静的検査を回す。
- 前例なし: 編集ごとlintとStop lintのA/B測定。

## Sources

- `rules/decisions/2026-09-23-all-languages-format-and-gate.md`
- `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md`
- staticcheck: https://staticcheck.dev/docs/running-staticcheck/ci/ 、stylelint CLI: https://stylelint.io/user-guide/cli

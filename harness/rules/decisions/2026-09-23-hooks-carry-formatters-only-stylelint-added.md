# jig のフックが自前で回すのは整形と型検査だけ、例外は設定のある stylelint、他の検査は許可リストと指示文で

Status: accepted — staticcheck / clippy / race / html-validate の自動フック配線は業界で少数かつ低 star、ベンダー自身が CI 向けと位置付け、stylelint だけ PostToolUse への実配線が二桁ある（2026-09-23）

rule: jig's own hook tables run formatters on edit and type-check/lint gates at Stop, nothing else; the one addition is stylelint on edit for .css/.scss/.sass/.less when the project has a stylelint config (config or silence). Never wire staticcheck, cargo clippy, go test -race or html-validate into hooks; make them runnable through guard permits and tell the model in AGENTS.md to run the language's static checks before claiming completion. Let rustfmt read the project's edition instead of hard-coding one.

## Problem

退役した yoki のフックは、整形と型検査のほかに「編集ごとの `go vet` + `staticcheck`」「strict 時の `go test -race`」「編集ごとの `ruff check`」「eslint / oxlint の段」「stylelint と html-validate」を持っていた。jig の対応表（プロジェクトが手順を持たないときの既定）にそれらを足すか、足すなら編集ごとか Stop か。

## Decision

- **足すのは stylelint だけ。** `.css .scss .sass .less` の編集ごと、プロジェクトに stylelint の設定があるときに限る。設定が無ければ何もしない（設定か沈黙か）。
- **staticcheck、cargo clippy、`go test -race`、html-validate はフックに入れない。** 走らせられるように guard の permit に入れ（`policy/guard-rules.json`、持ち主が貼る）、`rules/common` の一行で「完了を言う前にその言語の静的検査（Go: staticcheck、Rust: clippy）を回す」と教える。プロジェクトが手順を持つならそちらが走る（前の裁定）。
- 編集ごとの `ruff check` は足さない。lint は Stop の `ruff check .` に一本化。
- rustfmt の `--edition 2021` 決め打ちをやめ、rustfmt に `rustfmt.toml` / `Cargo.toml` の edition を読ませる。

## Alternatives considered

- **Stop ゲートで staticcheck / clippy を強制する**: 確実に走るが、実配線は少数（staticcheck + Stop 実配線 13 件、検証できたのは 0★ と 13★）、clippy はビルド一回分の待ちが毎ターン乗る。静的検査をどこかで走らせるという要件は、プロジェクトの手順・CI・許可リスト + 指示文の三つで満たされ、フックだけが置き場ではない。却下。
- **`jig init hooks` で lefthook.yml の雛形を配る**: git フックはプロジェクト側の道具で、ハーネスの領分ではない。jig がプロジェクトにファイルを作る経路を持たない方が、仕事のリポジトリでも安全。却下。
- **race を無人実行だけ回す**: 分岐が増える割に、無人実行の成功条件は goal 側で機械的に決める（loop-native-goal の裁定）ので、そこに `go test -race` を書けば足りる。却下。

## Consequences

- `format.ts` に stylelint の項を足す（設定検出: `.stylelintrc*` / `stylelint.config.*` / `package.json` の `stylelint` キー）。`.scss .sass .less` は stylelint の項だけに載り、biome / prettier の表には載せない。
- guard の permit 断片（staticcheck、cargo clippy、go test、stylelint、html-validate）を dry-run が印字し、持ち主が `policy/guard-rules.json` に貼る。
- `rules/common/50-quality-and-testing.md` に一行: 完了を言う前にその言語の静的検査を回す。
- 前例なし: 編集ごと lint と Stop lint の A/B 測定。

## Sources

- `rules/decisions/2026-09-23-all-languages-format-and-gate.md`
- `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md`
- staticcheck: https://staticcheck.dev/docs/running-staticcheck/ci/ 、stylelint CLI: https://stylelint.io/user-guide/cli

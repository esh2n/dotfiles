# jig の既定の対応表は全言語に整形と型検査の両方を持つ、言語で品質に差をつけない

Status: accepted — 対応表型（拡張子 → 標準ツール 1 つ）は業界の多数派で、各言語に事実上の標準整形器がある。Stop の型検査は作業中のプロジェクトの言語だけに走るので他言語のコストは乗らず、既に TS の tsc・Rust の cargo check が払っている種類の待ちを他言語にも等しく払う（2026-09-23、持ち主「どの言語でもクオリティを求めて欲しい」）

rule: jig's fallback tables cover every language the rules tree knows — C++, C#, Java, Kotlin, Perl, PHP, Swift join TS/JS, Go, Python, Rust — each with one edit-time formatter and one Stop-time incremental compile or type check chosen by the project's marker file; a missing tool is a silent skip, never an error. Do not leave a language with no gate on the grounds of latency: the gate only ever runs the current project's own language.

## Problem

jig の対応表は C++ / C# / Java / Kotlin / Perl / PHP / Swift で「何もしない」。旧 `hooks.md` には助言だけがあり、実装は一度も無かった。プロジェクトが手順を持たないときの既定として、これらに何を持たせるか。

## Decision

- **7 言語とも、編集ごとの整形と Stop の型検査を対応表に足す。** 整形は各言語の事実上の標準（C++: clang-format、C#: `dotnet format`、Java: google-java-format、Kotlin: ktfmt か ktlint、Perl: perltidy、PHP: pint か php-cs-fixer、Swift: swiftformat）。二択の言語はプロジェクトの設定ファイルの有無で選ぶ。
- **Stop はツールチェーンの増分ビルド／型検査**: C++ `cmake --build`、C# `dotnet build --no-restore`、Java `./gradlew compileJava` / `mvn -q compile`、Kotlin `./gradlew compileKotlin`、Perl `perl -c`（触ったファイル）、PHP `php -l`（触ったファイル）+ phpstan（設定があれば）、Swift `swift build`。印は `CMakeLists.txt`、`*.csproj`/`*.sln`、`pom.xml`/`build.gradle*`、`build.gradle.kts`、`cpanfile`、`composer.json`、`Package.swift`。正確なコマンド形は実装時に各ツールの公式 docs で確認して記す。
- ツールが無ければ黙ってスキップ。プロジェクトの手順（lefthook / pre-commit）があればそれが先（前の裁定）。

## Alternatives considered

- **整形だけ足し、Stop の型検査は足さない**（当初の推し）: 「ビルド一回分の待ちを毎ターン乗せない」が理由だったが、ゲートは作業中のプロジェクトの言語にしか走らず、TS の tsc や Rust の cargo check が既に同じ種類の待ちを払っている。言語で差をつける根拠が無い。却下。
- **7 言語を対応表から外したまま**: 「使われていない ≠ 要らない」。軸は業界評価と用途で、どの言語にも標準の整形器と増分検査がある。却下。

## Consequences

- `format.ts` と `gate.ts` の表が 11 言語になる。gate は「触ったファイル」を使う言語（Perl、PHP）のために、前の裁定で足した changed-files の口を再利用する。
- `rules/<lang>/hooks.md` 12 本は、この表を説明する短い文書に書き直すか消す（次の裁定）。
- 前例なし: これら 7 言語の PostToolUse / Stop 配線の公開実例の数は個別に測っていない。

## Sources

- `rules/research/2026-09-23-per-language-hooks-and-rule-delivery.md`
- `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md`、`2026-09-23-hooks-carry-formatters-only-stylelint-added.md`

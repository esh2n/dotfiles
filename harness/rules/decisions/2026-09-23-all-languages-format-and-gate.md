# jigの既定の対応表は全言語に整形と型検査の両方を持つ、言語で品質に差をつけない

Status: accepted — 対応表型（拡張子 → 標準ツール1つ）は業界の多数派で、各言語に事実上の標準整形器がある。Stopの型検査は作業中のプロジェクトの言語だけに走るので他言語のコストは乗らず、既にTSのtsc・Rustのcargo checkが払っている種類の待ちを他言語にも等しく払う（持ち主の裁定、2026-09-23。要件はどの言語でも同じ品質を求めること）

rule: jig's fallback tables cover every language the rules tree knows — C++, C#, Java, Kotlin, Perl, PHP, Swift join TS/JS, Go, Python, Rust — each with one edit-time formatter and one Stop-time incremental compile or type check chosen by the project's marker file; a missing tool is a silent skip, never an error. Do not leave a language with no gate on the grounds of latency: the gate only ever runs the current project's own language.
scope: repo

## Problem

jigの対応表はC++ / C# / Java / Kotlin / Perl / PHP / Swiftで「何もしない」。旧`hooks.md`には助言だけがあり、実装は一度も無かった。プロジェクトが手順を持たないときの既定として、これらに何を持たせるか。

## Decision

- **7言語とも、編集ごとの整形とStopの型検査を対応表に足す。** 整形は各言語の事実上の標準（C++: clang-format、C#: `dotnet format`、Java: google-java-format、Kotlin: ktfmtかktlint、Perl: perltidy、PHP: pintかphp-cs-fixer、Swift: swiftformat）。二択の言語はプロジェクトの設定ファイルの有無で選ぶ。
- **Stopはツールチェーンの増分ビルド／型検査**: C++ `cmake --build`、C# `dotnet build --no-restore`、Java `./gradlew compileJava` / `mvn -q compile`、Kotlin `./gradlew compileKotlin`、Perl `perl -c`（触ったファイル）、PHP `php -l`（触ったファイル）+ phpstan（設定があれば）、Swift `swift build`。印は`CMakeLists.txt`、`*.csproj`/`*.sln`、`pom.xml`/`build.gradle*`、`build.gradle.kts`、`cpanfile`、`composer.json`、`Package.swift`。正確なコマンド形は実装時に各ツールの公式docsで確認して記す。
- ツールが無ければ黙ってスキップ。プロジェクトの手順（lefthook / pre-commit）があればそれが先（前の裁定）。

## Alternatives considered

- **整形だけ足し、Stopの型検査は足さない**（当初の推し）: 「ビルド一回分の待ちを毎ターン乗せない」が理由だったが、ゲートは作業中のプロジェクトの言語にしか走らず、TSのtscやRustのcargo checkが既に同じ種類の待ちを払っている。言語で差をつける根拠が無い。却下。
- **7言語を対応表から外したまま**: 「使われていない ≠ 要らない」。軸は業界評価と用途で、どの言語にも標準の整形器と増分検査がある。却下。

## Consequences

- `format.ts`と`gate.ts`の表が11言語になる。gateは「触ったファイル」を使う言語（Perl、PHP）のために、前の裁定で足したchanged-filesの口を再利用する。
- `rules/<lang>/hooks.md` 12本は、この表を説明する短い文書に書き直すか消す（次の裁定）。
- 前例なし: これら7言語のPostToolUse / Stop配線の公開実例の数は個別に測っていない。

## Sources

- Biome（対応表型の事実上の標準整形器、速度）: https://biomejs.dev/
- staticcheck（ベンダー自身はCI/エディタでの利用を想定しStopゲートには言及しない、位置づけの対比として）: https://staticcheck.dev/docs/
- Claude Code hooksのタイムアウト既定値（PostToolUse/Stopは600秒、重い検査でも障害になりにくい根拠）: https://code.claude.com/docs/en/hooks
- `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md`、`2026-09-23-hooks-carry-formatters-only-stylelint-added.md`

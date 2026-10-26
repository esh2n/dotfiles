---
title: VSCode
description: 98 の extension を含む VSCode の構成。
---

VSCodeのextension listをdotfilesで管理している。テーマ系、言語サポート、Git連携、生産性ツールなど98のextension。

## Extension一覧

### Theme

| Extension | 説明 |
|-----------|------|
| Catppuccin | Catppuccin color theme |
| One Dark Pro | Atom One Dark移植 |
| Nord | Nord color theme |
| Tokyo Night | Tokyo Night theme |
| Dracula | Dracula theme |
| Gruvbox | Gruvbox theme |
| Rosé Pine | Rosé Pine theme |
| Solarized | Solarized theme |
| Everforest | Everforest theme |
| Kanagawa | Kanagawa theme |
| Material Theme | Material Design theme |

### Icon

| Extension | 説明 |
|-----------|------|
| Material Icon Theme | file/folder icon |

### Language support

| Extension | 言語 |
|-----------|------|
| rust-analyzer | Rust |
| Go | Go |
| C# Dev Kit / C# | .NET / C# |
| Python / Pylance / debugpy / isort | Python |
| Deno | Deno |
| Biome | JS/TS formatter/linter |
| Prisma | Prisma schema |
| Svelte | Svelte |
| MDX | MDX |
| Nix IDE | Nix |
| ShellCheck | Shell script linting |
| vscode-proto3 / protolint | Protocol Buffers |
| GraphQL / GraphQL Syntax | GraphQL |
| YAML | YAML |
| XML | XML |
| TOML (Even Better TOML) | TOML |
| Dart Import | Dart |
| Gemfile | Ruby Gemfile |
| Nginx Conf | Nginx |
| Firestore Rules | Firebase |
| INI Format | INI files |

### Git / GitHub

| Extension | 説明 |
|-----------|------|
| GitLens | Git blame, history, annotation |
| Git History | commit history viewer |
| GitHub Pull Requests | PR review in editor |
| GitHub Actions | workflow file support |
| GitHub Copilot | AI completion |
| Gemini Code Assist | Google AI assistant |
| Google Cloud Code | GCP連携 |

### Web / Frontend

| Extension | 説明 |
|-----------|------|
| Tailwind CSS IntelliSense | class name補完 |
| Headwind | Tailwind class sort |
| HTML Snippets | HTML snippet |
| HTML CSS Support | HTML + CSS |
| CSS Peek | CSS definition jump |
| Auto Rename Tag | HTML tagのauto rename |
| HTML Tag Wrap | selectionをtagでwrap |
| Emmet | JSX / TSX用Emmet |
| ES7 React Snippets | React snippet |
| Simple React Snippets | React snippet (lightweight) |
| Next.js Snippets | Next.js snippet |
| JS/JSX Snippets | JS/JSX snippet |
| TS Importer | TypeScript auto import |
| Import Cost | importのbundle size表示 |
| Pretty TS Errors | TypeScript errorを読みやすく |

### Editor enhancement

| Extension | 説明 |
|-----------|------|
| Error Lens | errorをinline表示 |
| Path Intellisense | file path補完 |
| Bracket Pair Toggler | bracket pair highlight toggle |
| Indent Rainbow | indent levelを色分け |
| Color Highlight | color codeをハイライト |
| Color Picker | color picker UI |
| Highlight Matching Tag | matching tagのハイライト |
| Better Comments | commentを色分け |
| Code Spell Checker | typo検出 |
| EditorConfig | .editorconfig support |
| Output Colorizer | output panelの色付け |
| Rainbow CSV | CSVの列ごと色分け |
| 全角チェッカー | 全角文字のハイライト |

### Document / Diagram

| Extension | 説明 |
|-----------|------|
| Markdown All in One | Markdown支援 |
| Markdown Lint | Markdown linting |
| Markdown Mermaid | Mermaid diagram preview |
| PlantUML | PlantUML diagram |
| SVG Preview | SVGファイルpreview |
| txt-syntax | plain text syntax highlight |

### Infrastructure

| Extension | 説明 |
|-----------|------|
| Docker | Docker file support |
| Dev Containers | Remote Containers |
| Kubernetes Tools | K8s管理 |
| Terraform | Terraform support |
| Makefile Tools | Makefile support |
| dotenv | .env file support |
| gRPC Client | gRPC testing |

### Testing

| Extension | 説明 |
|-----------|------|
| Test Explorer | test runner UI |
| Test Adapter Converter | test adapter変換 |
| Playwright | Playwright test support |
| Crates | Rust crate version管理 |

## Extensionの管理

extension listは`~/.config/vscode/extensions.txt`に保持。installは`dotctl editor extensions`（別名`install-extensions`）が、入っているVS CodeとCursorの両方に行う。

```bash
# export
code --list-extensions > extensions.txt

# install
dotctl editor extensions
```

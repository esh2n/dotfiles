---
title: VSCode
description: 97 の extension を含む VSCode の構成。
---

VSCode の extension list を dotfiles で管理している。テーマ系、言語サポート、Git 連携、生産性ツールなど 97 の extension。

## Extension 一覧

### Theme

| Extension | 説明 |
|-----------|------|
| Catppuccin | Catppuccin color theme |
| One Dark Pro | Atom One Dark 移植 |
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
| Google Cloud Code | GCP 連携 |

### Web / Frontend

| Extension | 説明 |
|-----------|------|
| Tailwind CSS IntelliSense | class name 補完 |
| Headwind | Tailwind class sort |
| HTML Snippets | HTML snippet |
| HTML CSS Support | HTML + CSS |
| CSS Peek | CSS definition jump |
| Auto Rename Tag | HTML tag の auto rename |
| HTML Tag Wrap | selection を tag で wrap |
| Emmet | JSX / TSX 用 Emmet |
| ES7 React Snippets | React snippet |
| Simple React Snippets | React snippet (lightweight) |
| Next.js Snippets | Next.js snippet |
| JS/JSX Snippets | JS/JSX snippet |
| TS Importer | TypeScript auto import |
| Import Cost | import の bundle size 表示 |
| Pretty TS Errors | TypeScript error を読みやすく |

### Editor enhancement

| Extension | 説明 |
|-----------|------|
| Error Lens | error を inline 表示 |
| Path Intellisense | file path 補完 |
| Bracket Pair Toggler | bracket pair highlight toggle |
| Indent Rainbow | indent level を色分け |
| Color Highlight | color code をハイライト |
| Color Picker | color picker UI |
| Highlight Matching Tag | matching tag のハイライト |
| Better Comments | comment を色分け |
| Code Spell Checker | typo 検出 |
| EditorConfig | .editorconfig support |
| Output Colorizer | output panel の色付け |
| Rainbow CSV | CSV の列ごと色分け |
| 全角チェッカー | 全角文字のハイライト |

### Document / Diagram

| Extension | 説明 |
|-----------|------|
| Markdown All in One | Markdown 支援 |
| Markdown Lint | Markdown linting |
| Markdown Mermaid | Mermaid diagram preview |
| PlantUML | PlantUML diagram |
| SVG Preview | SVG ファイル preview |
| txt-syntax | plain text syntax highlight |

### Infrastructure

| Extension | 説明 |
|-----------|------|
| Docker | Docker file support |
| Dev Containers | Remote Containers |
| Kubernetes Tools | K8s 管理 |
| Terraform | Terraform support |
| Makefile Tools | Makefile support |
| dotenv | .env file support |
| gRPC Client | gRPC testing |

### Testing

| Extension | 説明 |
|-----------|------|
| Test Explorer | test runner UI |
| Test Adapter Converter | test adapter 変換 |
| Playwright | Playwright test support |
| Crates | Rust crate version 管理 |

## Extension の管理

extension list は `~/.config/vscode/extensions.txt` に保持。install / export は script で行う。

```bash
# export
code --list-extensions > extensions.txt

# install
cat extensions.txt | xargs -L 1 code --install-extension
```

---
title: VSCode
description: VSCode setup with 97 extensions.
---

VSCode extensions are managed as a list in dotfiles. Includes themes, language support, Git integration, and productivity tools — 97 extensions total.

## Extensions

### Themes

| Extension | Description |
|-----------|-------------|
| Catppuccin | Catppuccin color theme |
| One Dark Pro | Atom One Dark port |
| Nord | Nord color theme |
| Tokyo Night | Tokyo Night theme |
| Dracula | Dracula theme |
| Gruvbox | Gruvbox theme |
| Rosé Pine | Rosé Pine theme |
| Solarized | Solarized theme |
| Everforest | Everforest theme |
| Kanagawa | Kanagawa theme |
| Material Theme | Material Design theme |

### Icons

| Extension | Description |
|-----------|-------------|
| Material Icon Theme | File and folder icons |

### Language support

| Extension | Language |
|-----------|---------|
| rust-analyzer | Rust |
| Go | Go |
| C# Dev Kit / C# | .NET / C# |
| Python / Pylance / debugpy / isort | Python |
| Deno | Deno |
| Biome | JS/TS formatter and linter |
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

| Extension | Description |
|-----------|-------------|
| GitLens | Git blame, history, annotations |
| Git History | Commit history viewer |
| GitHub Pull Requests | PR review in editor |
| GitHub Actions | Workflow file support |
| GitHub Copilot | AI completion |
| Gemini Code Assist | Google AI assistant |
| Google Cloud Code | GCP integration |

### Web / Frontend

| Extension | Description |
|-----------|-------------|
| Tailwind CSS IntelliSense | Class name completion |
| Headwind | Tailwind class sorting |
| HTML Snippets | HTML snippets |
| HTML CSS Support | HTML + CSS |
| CSS Peek | CSS definition jumping |
| Auto Rename Tag | HTML tag auto rename |
| HTML Tag Wrap | Wrap selection with tag |
| Emmet | JSX/TSX Emmet |
| ES7 React Snippets | React snippets |
| Simple React Snippets | React snippets (lightweight) |
| Next.js Snippets | Next.js snippets |
| JS/JSX Snippets | JS/JSX snippets |
| TS Importer | TypeScript auto import |
| Import Cost | Display import bundle size |
| Pretty TS Errors | Readable TypeScript errors |

### Editor enhancements

| Extension | Description |
|-----------|-------------|
| Error Lens | Inline error display |
| Path Intellisense | File path completion |
| Bracket Pair Toggler | Bracket pair highlight toggle |
| Indent Rainbow | Color-coded indent levels |
| Color Highlight | Highlight color codes |
| Color Picker | Color picker UI |
| Highlight Matching Tag | Matching tag highlight |
| Better Comments | Color-coded comments |
| Code Spell Checker | Typo detection |
| EditorConfig | .editorconfig support |
| Output Colorizer | Color output panel |
| Rainbow CSV | Color-coded CSV columns |

### Documentation / Diagrams

| Extension | Description |
|-----------|-------------|
| Markdown All in One | Markdown support |
| Markdown Lint | Markdown linting |
| Markdown Mermaid | Mermaid diagram preview |
| PlantUML | PlantUML diagrams |
| SVG Preview | SVG file preview |

### Infrastructure

| Extension | Description |
|-----------|-------------|
| Docker | Dockerfile support |
| Dev Containers | Remote Containers |
| Kubernetes Tools | K8s management |
| Terraform | Terraform support |
| Makefile Tools | Makefile support |
| dotenv | .env file support |
| gRPC Client | gRPC testing |

### Testing

| Extension | Description |
|-----------|-------------|
| Test Explorer | Test runner UI |
| Test Adapter Converter | Test adapter conversion |
| Playwright | Playwright test support |
| Crates | Rust crate version management |

## Managing extensions

The extension list is stored in `~/.config/vscode/extensions.txt`.

```bash
# Export
code --list-extensions > extensions.txt

# Install
cat extensions.txt | xargs -L 1 code --install-extension
```

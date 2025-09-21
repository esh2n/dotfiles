# Neovim推奨フォント

## プログラミング用Nerd Fonts

### 1. JetBrains Mono Nerd Font（推奨）
- 特徴：読みやすさと美しさのバランスが良い
- リガチャ（合字）対応
```bash
brew tap homebrew/cask-fonts
brew install --cask font-jetbrains-mono-nerd-font
```

### 2. Hack Nerd Font
- 特徴：シンプルで読みやすい
```bash
brew install --cask font-hack-nerd-font
```

### 3. FiraCode Nerd Font
- 特徴：豊富なリガチャ、プログラミング記号が美しい
```bash
brew install --cask font-fira-code-nerd-font
```

### 4. CaskaydiaCove Nerd Font (Cascadia Code)
- 特徴：Microsoft製、モダンで読みやすい
```bash
brew install --cask font-caskaydia-cove-nerd-font
```

### 5. SauceCodePro Nerd Font (Source Code Pro)
- 特徴：Adobe製、バランスが良い
```bash
brew install --cask font-sauce-code-pro-nerd-font
```

## 日本語フォント

### Noto Sans CJK JP
```bash
brew install --cask font-noto-sans-cjk-jp
```

## ターミナルでのフォント設定

### Ghostty
`~/.config/ghostty/config`:
```
font-family = JetBrainsMono Nerd Font
font-size = 14
```

### iTerm2
1. Preferences → Profiles → Text
2. Font: JetBrainsMono Nerd Font
3. Size: 14pt

### Alacritty
`~/.config/alacritty/alacritty.yml`:
```yaml
font:
  normal:
    family: JetBrainsMono Nerd Font
  size: 14.0
```

## フォント確認方法

Neovim内で以下のコマンドを実行：
```vim
:echo &guifont
```

アイコンが正しく表示されるか確認：
```vim
:Telescope symbols
```
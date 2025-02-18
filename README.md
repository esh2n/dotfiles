# dotfiles


## インストール

```bash
git clone https://github.com/esh2n/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
chmod +x install.sh
./install.sh
```

## 環境変数の設定

1. `.env.example`をコピーして`.env`ファイルを作成
```bash
cp .env.example .env
```

2. `.env`ファイルを編集して必要な環境変数を設定
```bash
# WeatherAPI (WezTerm)
OPENWEATHER_API_KEY=your_api_key_here  # OpenWeatherMap APIキーを設定
```

3. 環境変数を反映するために以下のコマンドを実行
```bash
source ~/.zshrc
```

> 注意: 環境変数は`.zshrc`を通じて読み込まれます。新しい環境変数を追加した場合は、`source ~/.zshrc`を実行するか、ターミナルを再起動してください。

## 構成

- Shell (Zsh)
- Neovim
- WezTerm
- iTerm2
- Git
- Raycast
- Helix
- VSCode
- Zed
- Tmux
- Tig
- Proto Tools
- Starship

## パッケージマネージャー

以下のパッケージマネージャーを使用しています：

- Homebrew
- Go
- Cargo (Rust)
- RubyGems
- npm

## ディレクトリ構造

```
.
├── README.md
├── install.sh
├── shell/
│   └── zsh/
├── config/
│   ├── nvim/
│   ├── wezterm/
│   ├── helix/
│   └── ...
├── git/
└── packages/
```

## ライセンス

MIT

[esh2n](https://github.com/esh2n) 
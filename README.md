# dotfiles

My personal dotfiles for macOS development environment. This repository contains configuration files for various tools and applications I use daily.

## Installation

```bash
git clone https://github.com/esh2n/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
chmod +x install.sh
./install.sh
```

## Environment Variables

1. Create `.env` file by copying `.env.example`
```bash
cp .env.example .env
```

2. Edit `.env` file with your environment variables
```bash
# WeatherAPI (WezTerm)
OPENWEATHER_API_KEY=your_api_key_here  # Set your OpenWeatherMap API key
```

3. Apply environment variables by running
```bash
source ~/.zshrc
```

> Note: Environment variables are loaded through `.zshrc`. When adding new environment variables, run `source ~/.zshrc` or restart your terminal.

## Components

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

## Package Managers

The following package managers are used:

- Homebrew
- Go
- Cargo (Rust)
- RubyGems
- npm

## Directory Structure

```
.
├── README.md
├── install.sh
├── shell/          # Shell configurations
│   └── zsh/        # Zsh specific configurations
├── config/         # Application configurations
│   ├── nvim/       # Neovim configuration
│   ├── wezterm/    # WezTerm configuration
│   ├── helix/      # Helix editor configuration
│   └── ...
├── git/            # Git configurations
└── packages/       # Package management files
```

## Features

- Modern terminal setup with WezTerm and Tmux
- Powerful text editing with Neovim, Helix, and VSCode
- Efficient shell environment with Zsh and Starship prompt
- Comprehensive Git configuration and aliases
- Productivity tools integration (Raycast, etc.)
- Automated setup and installation process
- Environment variable management
- Cross-platform compatibility (primarily macOS focused)

## License

MIT

[esh2n](https://github.com/esh2n) 
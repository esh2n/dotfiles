# OS判定
OSTYPE=$(uname -s)
IS_WSL=0
if [ "$OSTYPE" = "Linux" ]; then
  if grep -qi microsoft /proc/version 2>/dev/null || grep -qi wsl /proc/version 2>/dev/null; then
    IS_WSL=1
  fi
fi

# Homebrewの設定（OS別）
if [ "$OSTYPE" = "Darwin" ]; then
    # === macOS向けHomebrew設定 ===
    typeset -U path PATH
    path=(
        /opt/homebrew/bin(N-/)
        /usr/local/bin(N-/)
        $path
    )

    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
        PR_ARCH="ARM"
        export BREWx86_BASE=/opt/brew_x86
        export BREW_BASE=/opt/homebrew
        export PATH=${BREWx86_BASE}/bin:${BREWx86_BASE}/sbin${PATH:+:${PATH}}
        export PATH=${BREW_BASE}/bin:${BREW_BASE}/sbin${PATH:+:${PATH}}
        alias brewx86='/usr/local/bin/brew'
        
        # macOS ARM向けHomebrew初期化
        if [ -f "/opt/homebrew/bin/brew" ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    fi

    if [ "$ARCH" = "x86_64" ]; then
        PR_ARCH="x86"
        export BREW_BASE=/opt/brew_x86
        export PATH=${PATH//¥/homebrew¥//¥/brew_x86¥/}
        
        # macOS x86向けHomebrew初期化
        if [ -f "/usr/local/bin/brew" ]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    fi
else
    # === Linux/WSL向けHomebrew設定 ===
    # Linuxbrew標準パスを検索
    BREW_PATH=""
    if [ -f "/home/linuxbrew/.linuxbrew/bin/brew" ]; then
        BREW_PATH="/home/linuxbrew/.linuxbrew/bin/brew"
        export BREW_BASE="/home/linuxbrew/.linuxbrew"
    elif [ -f "$HOME/.linuxbrew/bin/brew" ]; then
        BREW_PATH="$HOME/.linuxbrew/bin/brew"
        export BREW_BASE="$HOME/.linuxbrew"
    fi
    
    # Homebrewが見つかった場合は初期化
    if [ -n "$BREW_PATH" ]; then
        # Linux向けHomebrew環境の設定（明示的にexport）
        eval "$($BREW_PATH shellenv)"
        
        # 環境変数を明示的に設定 (macOSと同様の方法で)
        export PATH="${BREW_BASE}/bin:${BREW_BASE}/sbin${PATH:+:${PATH}}"
        
        # PATHにLinuxbrewのディレクトリを追加
        typeset -U path PATH
        path=(
            ${BREW_BASE}/bin(N-/)
            ${BREW_BASE}/sbin(N-/)
            $path
        )
    fi
    
    # WSL固有の設定（必要に応じて）
    if [ "$IS_WSL" = "1" ]; then
        # WSL環境固有のHomebrew設定があれば追加
        :
    fi
fi
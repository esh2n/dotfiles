# OS判定
for __brew_base_dir in /usr/bin /bin /usr/sbin /sbin; do
  case ":${PATH}:" in
    *":${__brew_base_dir}:"*) ;;
    *) PATH="${__brew_base_dir}:${PATH}" ;;
  esac
done
unset __brew_base_dir

if [ -z "${HOMEBREW_PATH:-}" ]; then
  export HOMEBREW_PATH="$PATH"
fi

uname_cmd="/usr/bin/uname"
if [ ! -x "$uname_cmd" ] && [ -x "/bin/uname" ]; then
  uname_cmd="/bin/uname"
fi
if [ ! -x "$uname_cmd" ]; then
  uname_cmd=$(command -v uname 2>/dev/null)
fi
if [ -n "$uname_cmd" ]; then
  OSTYPE=$("$uname_cmd" -s)
else
  OSTYPE=${OSTYPE:-unknown}
fi
# Helper: determine if brew shellenv can run (needs readlink & dirname)
__brew_can_use_shellenv=0
if command -v readlink >/dev/null 2>&1 && command -v dirname >/dev/null 2>&1; then
  if "$(command -v readlink)" / >/dev/null 2>&1; then
    __brew_can_use_shellenv=1
  fi
fi

__brew_manual_env() {
  local prefix="$1"
  export HOMEBREW_PREFIX="$prefix"
  export HOMEBREW_CELLAR="$prefix/Cellar"
  export HOMEBREW_REPOSITORY="$prefix"

  case ":$PATH:" in
    *":$prefix/bin:"*) ;;
    *) PATH="$prefix/bin:${PATH}" ;;
  esac
  case ":$PATH:" in
    *":$prefix/sbin:"*) ;;
    *) PATH="$prefix/sbin:${PATH}" ;;
  esac
  export PATH

  if [ -n "${MANPATH:-}" ]; then
    case ":$MANPATH:" in
      *":$prefix/share/man:"*) ;;
      *) MANPATH="$prefix/share/man:$MANPATH" ;;
    esac
  else
    MANPATH="$prefix/share/man"
  fi
  export MANPATH

  if [ -n "${INFOPATH:-}" ]; then
    case ":$INFOPATH:" in
      *":$prefix/share/info:"*) ;;
      *) INFOPATH="$prefix/share/info:$INFOPATH" ;;
    esac
  else
    INFOPATH="$prefix/share/info"
  fi
  export INFOPATH

  if [ -z "${HOMEBREW_PATH:-}" ]; then
    export HOMEBREW_PATH="$PATH"
  fi
}
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
        "${path[@]}"
    )

    if [ -n "$uname_cmd" ]; then
        ARCH=$("$uname_cmd" -m)
    else
        ARCH=${ARCH:-unknown}
    fi
    if [ "$ARCH" = "arm64" ]; then
        PR_ARCH="ARM"
        export BREWx86_BASE=/opt/brew_x86
        export BREW_BASE=/opt/homebrew
        export PATH=${BREWx86_BASE}/bin:${BREWx86_BASE}/sbin${PATH:+:${PATH}}
        export PATH=${BREW_BASE}/bin:${BREW_BASE}/sbin${PATH:+:${PATH}}
        alias brewx86='/usr/local/bin/brew'
        
        # macOS ARM向けHomebrew初期化
        if [ -f "/opt/homebrew/bin/brew" ]; then
            if [ "$__brew_can_use_shellenv" -eq 1 ]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            else
                __brew_manual_env "/opt/homebrew"
            fi
        fi
    fi

    if [ "$ARCH" = "x86_64" ]; then
        PR_ARCH="x86"
        export BREW_BASE=/opt/brew_x86
        export PATH=${PATH//¥/homebrew¥//¥/brew_x86¥/}
        
        # macOS x86向けHomebrew初期化
        if [ -f "/usr/local/bin/brew" ]; then
            if [ "$__brew_can_use_shellenv" -eq 1 ]; then
                eval "$(/usr/local/bin/brew shellenv)"
            else
                __brew_manual_env "/usr/local"
            fi
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
        if [ "$__brew_can_use_shellenv" -eq 1 ]; then
            eval "$($BREW_PATH shellenv)"
        elif [ -n "${BREW_BASE:-}" ]; then
            __brew_manual_env "$BREW_BASE"
        fi
        
        # 環境変数を明示的に設定 (macOSと同様の方法で)
        export PATH="${BREW_BASE}/bin:${BREW_BASE}/sbin${PATH:+:${PATH}}"
        
        # PATHにLinuxbrewのディレクトリを追加
        typeset -U path PATH
        path=(
            ${BREW_BASE}/bin(N-/)
            ${BREW_BASE}/sbin(N-/)
            "${path[@]}"
        )
    fi
    
    # WSL固有の設定（必要に応じて）
    if [ "$IS_WSL" = "1" ]; then
        # WSL環境固有のHomebrew設定があれば追加
        :
    fi
fi

unset __brew_can_use_shellenv
unset -f __brew_manual_env 2>/dev/null || :

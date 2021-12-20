# https://zenn.dev/ress/articles/069baf1c305523dfca3d
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
fi
if [ "$ARCH" = "x86_64" ]; then
    PR_ARCH="x86"
    export BREW_BASE=/opt/brew_x86
    export PATH=${PATH//¥/homebrew¥//¥/brew_x86¥/}
fi
# echo $PR_ARCH

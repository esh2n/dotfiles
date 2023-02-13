# PATHs

export GROOT=~/go/github.com/esh2n
export AROOT=~/go/github.com/4sobiba
export DOTFILES_PATH=~/dotfiles

# bash
export PATH=$HOME/bin:/usr/local/bin:$PATH

# neovim
export XDG_CONFIG_HOME="$HOME/.config"

# docker
export DOCKER_CONTENT_TRUST=0

# gh
export VISUAL='nvim'

# dotfiles
export DOTFILES_PATH="$HOME/dotfiles"

# nodebrew
# export PATH=$HOME/.nodebrew/current/bin:$PATH
# export NVM_DIR="$HOME/.nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
# [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
# export PATH=/opt/local/bin:$PATH

# perl
if which plenv > /dev/null; then eval "$(plenv init - zsh)"; fi

# PHP@7.2
export PATH="/usr/local/opt/php@7.2/bin:$PATH"
export PATH="/usr/local/opt/php@7.2/sbin:$PATH"

# Composer
export PATH=~/.composer/vendor/bin:$PATH

# MySQL
export PATH="/usr/local/opt/mysql@5.7/bin:$PATH"

# python
export PYENV_ROOT="$HOME/.pyenv"
if [ -x "${PYENV_ROOT}/bin" ]; then
  export PATH=${PYENV_ROOT}/bin:${PATH}
fi
if [ -x "$(which pyenv)" ]; then
eval "$(pyenv init - zsh)"
eval "$(pyenv virtualenv-init -)"
fi

# Ruby
export PATH="~/.rbenv/shims:/usr/local/bin:$PATH"
eval "$(rbenv init -)"

# Flutter
# export PATH=$PATH:~/flutter/flutter/bin
export PATH="$PATH":"$HOME/.pub-cache/bin"
# export PATH="$PATH":"$HOME/flutter/flutter/.pub-cache/bin"
export PATH="$PATH":"$HOME/fvm/default/bin"
# asdf
# . $(brew --prefix asdf)/asdf.sh

# Android Studio
export ANDROID_HOME=~/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator

# go
export GOPATH=$HOME/go
export GOENV_ROOT=$HOME/.goenv
export PATH="$GOENV_ROOT/bin:$PATH"
eval "$(goenv init -)"
export PATH="$GOROOT/bin:$PATH"
export PATH="$PATH:$GOPATH/bin"
GOENV_DISABLE_GOPATH=1
export GOPRIVATE=*.corp.example.com,github.com/GincoInc/*
# export GOPATH=$HOME/go
# geth
export PATH="$HOME/geth:$PATH"

# solana
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# mona
export PATH="$HOME/monacoin-0.20.2/bin:$PATH"

# java
export PATH="$HOME/.jenv/bin:$PATH"
eval "$(jenv init -)"
# export JAVA_HOME=$(/usr/libexec/java_home -v 11)

# deno
export DENO_INSTALL="~/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"
export PATH="~/.deno/bin:$PATH"

# rust
export PATH="$HOME/.cargo/bin:$PATH"
export LIBRARY_PATH="$LIBRARY_PATH:/usr/local/lib"
. "$HOME/.cargo/env"

# prettier
export PATH=$PATH:./node_modules/.bin

# elm-format
export PATH=$HOME:~/elm:$PATH

export LDFLAGS="-L/usr/local/opt/zlib/lib"
export CPPFLAGS="-I/usr/local/opt/zlib/include"
export PKG_CONFIG_PATH="/usr/local/opt/zlib/lib/pkgconfig"
export PATH="/usr/local/opt/make/libexec/gnubin:$PATH"

# homebrew
export PATH="/opt/homebrew/bin:$PATH"
# eval "$(/opt/homebrew/bin/brew shellenv)"
# export PATH="/opt/homebrew/bin:$PATH"

#
export LDFLAGS="-L/opt/homebrew/opt/bzip2/lib"
export CPPFLAGS="-I/opt/homebrew/opt/bzip2/include"
export PATH="/opt/homebrew/opt/bzip2/bin:$PATH"
export PKG_CONFIG_PATH="/opt/homebrew/opt/zlib/lib/pkgconfig"
export LDFLAGS="-L/opt/homebrew/opt/zlib/lib"
export CPPFLAGS="-I/opt/homebrew/opt/zlib/include"

# ken
export PATH="$HOME/ken/ken-darwin-10.10-amd64/bin:$PATH"
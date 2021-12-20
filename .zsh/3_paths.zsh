# PATHs

export GROOT=/Users/esh2n/go/github.com/esh2n
export AROOT=/Users/esh2n/go/github.com/4sobiba
export DOTFILES_PATH=/Users/esh2n/dotfiles

# bash
export PATH=$HOME/bin:/usr/local/bin:$PATH

# neovim
export XDG_CONFIG_HOME="$HOME/.config"

# docker
export DOCKER_CONTENT_TRUST=1

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

# python
export PYENV_ROOT="$HOME/.pyenv"
if [ -x "${PYENV_ROOT}/bin" ]; then
  export PATH=${PYENV_ROOT}/bin:${PATH}
fi
if [ -x "$(which pyenv)" ]; then
eval "$(pyenv init - zsh)"
eval "$(pyenv virtualenv-init -)"
fi

# PHP@7.2
export PATH="/usr/local/opt/php@7.2/bin:$PATH"
export PATH="/usr/local/opt/php@7.2/sbin:$PATH"

# Composer
export PATH=~/.composer/vendor/bin:$PATH

# MySQL
export PATH="/usr/local/opt/mysql@5.7/bin:$PATH"

# Ruby
export PATH="~/.rbenv/shims:/usr/local/bin:$PATH"
eval "$(rbenv init -)"

# Flutter
export PATH=$PATH:~/flutter/flutter/bin
export PATH="$PATH":"$HOME/.pub-cache/bin"
# export PATH="$PATH":"$HOME/flutter/flutter/.pub-cache/bin"
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

# geth
export PATH="$HOME/geth:$PATH"

# java
export PATH="$HOME/.jenv/bin:$PATH"
eval "$(jenv init -)"
# export JAVA_HOME=$(/usr/libexec/java_home -v 11)

# deno
export DENO_INSTALL="~/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"
export PATH="/Users/esh2n/.deno/bin:$PATH"

# rust
export PATH="$HOME/.cargo/bin:$PATH"
export LIBRARY_PATH="$LIBRARY_PATH:/usr/local/lib"

# prettier
export PATH=$PATH:./node_modules/.bin

# elm-format
export PATH=$HOME:~/elm:$PATH

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/esh2n/google-cloud-sdk/path.zsh.inc' ]; then . '/Users/esh2n/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/Users/esh2n/google-cloud-sdk/completion.zsh.inc' ]; then . '/Users/esh2n/google-cloud-sdk/completion.zsh.inc'; fi

export LDFLAGS="-L/usr/local/opt/zlib/lib"
export CPPFLAGS="-I/usr/local/opt/zlib/include"
export PKG_CONFIG_PATH="/usr/local/opt/zlib/lib/pkgconfig"
export PATH="/usr/local/opt/make/libexec/gnubin:$PATH"

# homebrew
export PATH="/opt/homebrew/bin:$PATH"
# eval "$(/opt/homebrew/bin/brew shellenv)"
# export PATH="/opt/homebrew/bin:$PATH"
ZINIT_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/zinit/zinit.git"

source "${ZINIT_HOME}/zinit.zsh"
autoload -Uz _zinit
autoload -Uz compinit
(( ${+_comps} )) && _comps[zinit]=_zinit
compinit

autoload -Uz add-zsh-hook
autoload -Uz cdr
autoload -Uz chpwd_recent_dirs

# plugins: genaral load {{{
zinit light-mode for \
    zdharma-continuum/zinit-annex-as-monitor \
    zdharma-continuum/zinit-annex-bin-gem-node \
    zdharma-continuum/zinit-annex-patch-dl \
    zdharma-continuum/zinit-annex-rust
# 利用可能なエイリアスを使わずにコマンドを実行した際に通知するプラグインです。
zinit light 'djui/alias-tips'
export ZSH_PLUGINS_ALIAS_TIPS_TEXT='🗒 : '

# cd-gitroot コマンドをエイリアスで U に割り当てています。
zinit light 'mollifier/cd-gitroot'

# tmux のウィンドウを作業中のGitレポジトリ名に応じて自動的にリネームしてくれるプラグインです。(自分で作った)
zinit light 'sei40kr/zsh-tmux-rename'

# 作業ディレクトリに .env ファイルがあった場合に自動的にロードしてくれます。
zinit snippet 'OMZ::plugins/dotenv/dotenv.plugin.zsh'

# zsh の補完を使いやすく設定する oh-my-zsh のスニペットをロードします。
zinit snippet 'OMZ::lib/completion.zsh'
zinit snippet 'OMZ::lib/compfix.zsh'
# # fzf で絵文字を検索&入力ためのプラグインです。
# zinit light 'b4b4r07/emoji-cli'

# # fzf を使ったウィジェットが複数バンドルされたプラグインです。
# zinit light 'mollifier/anyframe'
# 作業中のGitのルートディレクトリまでジャンプするコマンドを定義するプラグインです。


# # ls よりも使いやすく見やすいディレクトリの一覧表示のコマンドを定義するプラグインです。
# zinit ice pick'k.sh'
# zinit light 'supercrabtree/k'

# コマンド入力待ち状態から control-Z で suspend したプロセスに復帰するキーバインドを設定するプラグインです。
# zinit snippet 'OMZ::plugins/fancy-ctrl-z/fancy-ctrl-z.plugin.zsh'
# Gitの補完と大量のエイリアスを定義するプラグインです。
# エイリアスは重宝するものが多く、Gitを使うユーザーには必ずオススメしたいプラグインです。
zinit snippet 'OMZ::plugins/git/git.plugin.zsh'
# GitHub のレポジトリを管理するためのコマンドを定義するプラグインです。
zinit snippet 'OMZ::plugins/github/github.plugin.zsh'
# 非GNU系OSにインストールしたGNU系ツールをプリフィックスなしで使えるようにするプラグインです。
zinit snippet 'OMZ::plugins/gnu-utils/gnu-utils.plugin.zsh'
# .zshrc を zcompile してロードしてくれる src コマンドを定義するプラグインです。
# }}}


# zinits: commands {{{
# Go で書かれたツール群を並列ダウンロード&ビルド&インストールしてくれます。
# zinit ice from'gh-r' as'command' mv'gotcha_* -> gotcha'
# zinit light 'b4b4r07/gotcha'

# zinits: completions {{{
# プラグインの中に含まれているコマンド補完のみを zinit で管理します。
# 想定された zinit の使い方ではないかもしれません。
zinit ice pick''
zinit light 'jsforce/jsforce-zsh-completions'
zinit ice pick''
zinit light 'zsh-users/zsh-completions'
# }}}
zinit wait lucid for \
    atinit"ZINIT[COMPINIT_OPTS]=-C; zicompinit; zicdreplay" \
        zdharma-continuum/fast-syntax-highlighting \
    blockf \
    zsh-users/zsh-completions \
    atload"!_zsh_autosuggest_start" \
        zsh-users/zsh-autosuggestions
# コマンドをサジェストするプラグインを遅延ロードします。
zinit ice wait'1' atload'_zsh_autosuggest_start'
zinit light 'zsh-users/zsh-autosuggestions'

# プロンプトのテーマを遅延ロードします。このプラグインのみロード完了後にプロンプトを再描画しています。
# zinit ice pick'spaceship.zsh' wait'!0'
# zinit light 'denysdovhan/spaceship-zsh-theme'
# }}}

fpath=(~/.zsh/completion $fpath)
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'
zinit cdreplay -q

function mkdir_and_change_directory() {
  if [ ! -n "$1" ]; then
    echo "🐛 Please enter a directory name."
  elif [ -d $1 ]; then
    echo "🐛 '$1' is already exists."
  else
    echo "⚡️ Create and move to '$1'."
    mkdir -p $1 && cd $1
  fi
}

function change_git_config() {
  local GLOBALL_OPT=""
  local ACCOUNT=""

  while getopts "gh" optKey; do
  case "$optKey" in
    g)
      GLOBALL_OPT="--global"
      ;;
    h)
      echo "📝 Usage: $0 [-g] [-a account]" 1>&2
      ;;
    \?)
      echo "📝 Usage: $0 [-g] [-a account]" 1>&2
      ;;
  esac
  done

  if [ "${GLOBALL_OPT}" = "--global" ]; then
    echo "⚡️ Change git config globally."
    ACCOUNT=$2
  else
    echo "⚡️ Change git config locally."
    ACCOUNT=$1
  fi

  if [ "${ACCOUNT}" = "pivot" ]; then
    git config $GLOBALL_OPT user.name "Shunya Endo"
    git config $GLOBALL_OPT user.email "shunyaendoh.bz@gmail.com"
    echo "👷 Account is 'pivot'."
  else
    git config $GLOBALL_OPT user.name "esh2n"
    git config $GLOBALL_OPT user.email "shunyaendoh.bz@gmail.com"
    echo "👷 Account is 'esh2n'."
  fi
}

function zle-line-init zle-keymap-select {
  RPS1="${${KEYMAP/vicmd/-- NORMAL --}/(main|viins)/-- INSERT --}"
  RPS2=${RPS1}
  zle reset-prompt
}

function peco_select_history() {
  local tac
  if which tac > /dev/null; then
    tac="tac"
  else
    tac="tail -r"
  fi
  BUFFER=$(fc -l -n 1 | eval $tac | peco --query "$LBUFFER")
  CURSOR=$#BUFFER
  zle clear-screen
}
function peco_select_src () {
  local selected_dir=$(pacifica | peco --query "$LBUFFER")
  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${selected_dir}"
    zle accept-line
  fi
  zle clear-screen
}

function peco_change_directory() {
  cd $(fasd -d | peco | awk '{print $2}')
}

#TODO リファクタする
#git ls-tree -r --name-only --full-tree HEADをつかう
#fzfのpreview機能使う
#"ls | fzf -0 -1 --ansi --reverse --height 1%
#"https://github.com/relastle/pmy
function peco_select_file_below_pwd() {
  if [ ! `pwd | grep "$(ghq root)"` ]; then
    echo "you are not in ghq path"
    zle accept-line
    return 0
  fi
  # grep -v -e で除外対象を指定
  local selected_path="\
    $(find . | \
    sed "s/^.//g" | \
    grep -v -e node_modules -e vendor -e /.git | \
    fzf --ansi --reverse --height 30% --border)"
  if [ -n "$selected_path" ]; then
    local dest_path=".$(echo $selected_path | awk '{print $1}')"
    go_to $dest_path
  fi
}
# ghqプロジェクト内で飛ぶ
function peco_select_file_within_project() {
  local base_path=$(pwd | grep -o "$(ghq list -p)")
  if [ -z $base_path ]; then
    echo "you are not in ghq project"
    zle accept-line
    return 0
  fi
  local trim_base_path="^$(echo $base_path | sed "s/\//./g")."
  local paths="\
    $(find $base_path | \
    sed "s/$trim_base_path//g" | \
    grep -v -e node_modules -e vendor -e .git)"
  local selected_path="$(echo "(root)\n$paths" | awk '{print $1}' | fzf --ansi --reverse --height 30% --border)"
  if [ -n "$selected_path" ]; then
    if [[ "$selected_path" = "(root)" ]]; then
      go_to $base_path
      return 0
    fi
    local dest_path="$base_path/$(echo $selected_path | awk '{print $1}')"
    go_to $dest_path
  fi
}
function go_to() {
  if [ -f $1 ]; then
    nvim $1
    dir_path=$(echo $1 | rev | cut -d '/' -f 2- | rev)
    BUFFER="cd $dir_path"
  elif [ -d $1 ]; then
    BUFFER="cd $1"
  else
    echo "selected path is neither file nor directory"
  fi
  zle accept-line
}
#TODO リファクタする
function peco_edit_file() {
  local selected_path="$(fasd -f | peco | awk '{print $2}')"
  if [ -n "$selected_path" ]; then
    nvim $selected_path
  fi
}
#TODO 関数名からpecoをはずす
function peco_select_branch_except_current() {
  git branch -a --sort=-authordate | \
    grep -v -e '->' -e '*' | \
    sed "s/remotes\/origin\///g" | \
    #重複行を削除 https://qiita.com/arcizan/items/9cf19cd982fa65f87546
    awk '!a[$0]++' | \
    fzf --ansi --reverse --height 20% --border
}
function peco_select_local_branch_except_current() {
  git branch | \
    grep -v -e '->' -e '*' | \
    sed "s/remotes\/origin\///g" | \
    #重複行を削除 https://qiita.com/arcizan/items/9cf19cd982fa65f87546
    awk '!a[$0]++' | \
    fzf --ansi --reverse --height 20% --border
}
function peco_select_branch_all() {
  git branch -a --sort=-authordate | \
    grep -v -e '->' | \
    sed "s/remotes\/origin\///g" | \
    sed "s/\*/ /g" | \
    #重複行を削除 https://qiita.com/arcizan/items/9cf19cd982fa65f87546
    awk '!a[$0]++' | \
    fzf --ansi --reverse --height 20% --border
}

function precmd() {
  if [ ! -z $TMUX ]; then
    tmux refresh-client -S
  fi
}

nerd_fonts() {
  git clone --branch=master --depth 1 https://github.com/ryanoasis/nerd-fonts.git
  cd nerd-fonts
  ./install.sh $1  # "Source" to install Sauce Code Nerd Font
  cd ..
  rm -rf nerd-fonts
}

# function gke-activate() {
#   name="$1"
#   zone_or_region="$2"
#   if echo "${zone_or_region}" | grep '[^-]*-[^-]*-[^-]*' > /dev/null; then
#     echo "gcloud container clusters get-credentials \"${name}\" --zone=\"${zone_or_region}\""
#     gcloud container clusters get-credentials "${name}" --zone="${zone_or_region}"
#   else
#     echo "gcloud container clusters get-credentials \"${name}\" --region=\"${zone_or_region}\""
#     gcloud container clusters get-credentials "${name}" --region="${zone_or_region}"
#   fi
# }
# function kx-complete() {
#   _values $(gcloud container clusters list | awk '{print $1}')
# }
# function kx() {
#   name="$1"
#   if [ -z "$name" ]; then
#     line=$(gcloud container clusters list | peco)
#     name=$(echo $line | awk '{print $1}')
#   else
#     line=$(gcloud container clusters list | grep "$name")
#   fi
#   zone_or_region=$(echo $line | awk '{print $2}')
#   gke-activate "${name}" "${zone_or_region}"
# }
# compdef kx-complete kx

function gcloud-activate() {
  name="$1"
  project="$2"
  echo "gcloud config configurations activate \"${name}\""
  gcloud config configurations activate "${name}"
}
function gx-complete() {
  _values $(gcloud config configurations list | awk '{print $1}')
}
function gx() {
  name="$1"
  if [ -z "$name" ]; then
    line=$(gcloud config configurations list | peco)
    name=$(echo "${line}" | awk '{print $1}')
  else
    line=$(gcloud config configurations list | grep "$name")
  fi
  project=$(echo "${line}" | awk '{print $4}')
  gcloud-activate "${name}" "${project}"
}
compdef gx-complete gx
# Cross-platform trash function
function trash() {
  # macOSの場合は標準のtrashコマンドを使用
  if [[ "$OSTYPE" == "darwin"* ]]; then
    command trash "$@"
    return $?
  fi

  # Windows (WSL)の場合のみ独自の処理
  if grep -q Microsoft /proc/version 2>/dev/null; then
    local recursive=false
    local force=false
    local args=()
    local protected_dirs=("$HOME" "/" "/home" "/usr" "/etc" "/var" "/bin" "/sbin" "/lib" "/lib64" "/boot" "/dev" "/proc" "/sys" "/tmp" "/opt" "/root")

    # Parse arguments for -r, -f flags
    for arg in "$@"; do
      case "$arg" in
        -r|-R)
          recursive=true
          ;;
        -f)
          force=true
          ;;
        -rf|-fr|-Rf|-fR)
          recursive=true
          force=true
          ;;
        *)
          args+=("$arg")
          ;;
      esac
    done

    # Check if any arguments are left after parsing flags
    if [ ${#args[@]} -eq 0 ]; then
      echo "❌ Error: Missing argument"
      echo "Usage: trash [-r] [-f] <file or directory>"
      return 1
    fi

    for item in "${args[@]}"; do
      if [[ ! -e "$item" ]]; then
        echo "⚠️ Warning: '$item' does not exist"
        continue
      fi

      # 絶対パスに変換
      local abs_path
      if [[ "$item" = /* ]]; then
        abs_path="$item"
      else
        abs_path="$(pwd)/$item"
      fi
      
      # パスの正規化（シンボリックリンクを解決し、重複するスラッシュを削除）
      abs_path=$(readlink -f "$abs_path" 2>/dev/null || echo "$abs_path")

      # Check for protected directories
      for protected in "${protected_dirs[@]}"; do
        # 正確なパス比較
        protected_abs=$(readlink -f "$protected" 2>/dev/null || echo "$protected")
        if [[ "$abs_path" == "$protected_abs" || "$abs_path" == "${protected_abs}/" ]]; then
          echo "🛑 保護されたディレクトリ '$item' はゴミ箱に移動できません"
          return 1
        fi
      done

      # Directory but not recursive flag
      if [[ -d "$item" && "$recursive" == false ]]; then
        echo "⚠️ '$item' はディレクトリです。削除するには -r フラグが必要です"
        continue
      fi

      # PowerShellを使用してゴミ箱に移動
      local windows_path
      windows_path=$(wslpath -w "$item" 2>/dev/null)
      
      # パス変換エラーチェック
      if [[ -z "$windows_path" ]]; then
        echo "❌ '$item' のWindowsパス変換に失敗しました"
        return 1
      fi
      
      echo "📂 変換: $item -> $windows_path"
      
      # ファイルかディレクトリかで適切なメソッドを使用
      local ps_command
      if [[ -d "$item" ]]; then
        ps_command="Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('$windows_path', 'OnlyErrorDialogs', 'SendToRecycleBin')"
      else
        ps_command="Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('$windows_path', 'OnlyErrorDialogs', 'SendToRecycleBin')"
      fi
      
      # エラー出力をキャプチャ
      local error_output
      error_output=$(powershell.exe -Command "$ps_command" 2>&1)
      
      if [[ $? -eq 0 && -z "$error_output" ]]; then
        echo "🗑️ '$item' をゴミ箱に移動しました"
      else
        echo "❌ '$item' をゴミ箱に移動できませんでした"
        if [[ -n "$error_output" ]]; then
          echo "エラー: $error_output"
        fi
        
        # 強制フラグがない場合は終了
        if [[ "$force" == false ]]; then
          return 1
        fi
      fi
    done
  fi
}

# trash関数が定義されたので、rmコマンドのエイリアスを設定
# alias rm='trash'  # このエイリアスはaliases.zshで設定します 
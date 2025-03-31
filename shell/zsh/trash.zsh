# Cross-platform trash function
function trash() {
  echo "🗑️ trash実行: $@"
  # macOSの場合は標準のtrashコマンドを使用
  if [[ "$OSTYPE" == "darwin"* ]]; then
    command trash "$@"
    return $?
  fi

  # Linux環境の場合
  # trash-cli（trash-put）があればそちらを使用
  if command -v trash-put &> /dev/null; then
    echo "trash-putを使用します"
    trash-put "$@"
    return $?
  fi

  # Windows (WSL)の場合の処理
  if grep -q -E "microsoft|wsl" /proc/version 2>/dev/null; then
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

      # より単純な方法でPowerShellを使用してゴミ箱に移動
      local windows_path
      windows_path=$(wslpath -w "$item" 2>/dev/null)
      
      # パス変換エラーチェック
      if [[ -z "$windows_path" ]]; then
        echo "❌ '$item' のWindowsパス変換に失敗しました"
        return 1
      fi
      
      echo "📂 変換: $item -> $windows_path"
      
      # 単純なPowerShellスクリプトを使用（recycle.exe使用）
      local ps_script='
      $path = "'$windows_path'"
      $shell = New-Object -ComObject "Shell.Application"
      $item = $shell.Namespace(0).ParseName($path)
      if ($item -ne $null) {
          $item.InvokeVerb("delete")
          "Success"
      } else {
          "Failed: Item not found"
      }
      '
      
      # PowerShellスクリプトを一時ファイルに保存して実行
      local temp_script="/tmp/trash_script_$$.ps1"
      echo "$ps_script" > "$temp_script"
      
      # デバッグ情報
      echo "🔍 実行するPowerShellスクリプト:"
      cat "$temp_script"
      
      # スクリプト実行
      local result
      result=$(powershell.exe -ExecutionPolicy Bypass -File "$temp_script" 2>&1)
      local exit_code=$?
      
      # 一時ファイル削除
      rm -f "$temp_script"
      
      # 結果確認
      if [[ $exit_code -eq 0 && "$result" == *"Success"* ]]; then
        echo "🗑️ '$item' をゴミ箱に移動しました"
      else
        echo "❌ '$item' をゴミ箱に移動できませんでした"
        echo "結果: $result"
        
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
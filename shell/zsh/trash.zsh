# Cross-platform trash function
function trash() {
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

    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS - use native trash command
      if command -v trash-cli >/dev/null 2>&1; then
        if trash-cli "$item"; then
          echo "🗑️ '$item' をゴミ箱に移動しました"
        else
          echo "❌ '$item' をゴミ箱に移動できませんでした"
          if [[ "$force" == false ]]; then
            return 1
          fi
        fi
      elif command -v trash >/dev/null 2>&1; then
        if command trash "$item"; then
          echo "🗑️ '$item' をゴミ箱に移動しました"
        else
          echo "❌ '$item' をゴミ箱に移動できませんでした"
          if [[ "$force" == false ]]; then
            return 1
          fi
        fi
      else
        echo "❌ Error: trash command not found"
        echo "💡 Install trash-cli:"
        echo "    brew install trash-cli"
        return 1
      fi
    elif grep -q Microsoft /proc/version 2>/dev/null; then
      # Windows (WSL) - first try trash-cli, then fallback to PowerShell
      local use_powershell=false
      
      if command -v trash-put >/dev/null 2>&1 && [[ ! -d "$item" || "$item" != "$HOME"/* ]]; then
        # trash-putはホームディレクトリ内のディレクトリ削除に問題がある場合があるため、
        # ホームディレクトリ内のディレクトリの場合はPowerShellを優先
        if trash-put "$item" 2>/dev/null; then
          echo "🗑️ '$item' をゴミ箱に移動しました"
        else
          # trash-putが失敗した場合はPowerShellを試みる
          use_powershell=true
        fi
      else
        use_powershell=true
      fi
      
      # PowerShellを使用
      if [[ "$use_powershell" == true ]]; then
        if command -v powershell.exe >/dev/null 2>&1; then
          local winpath=$(wslpath -w "$item")
          # フォルダとファイルの両方に対応
          if [[ -d "$item" ]]; then
            # ディレクトリの場合
            powershell.exe -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('$winpath', 'OnlyErrorDialogs', 'SendToRecycleBin', 'RecurseSubdirectories')" 2>/dev/null
            if [ $? -eq 0 ]; then
              echo "🗑️ '$item' をゴミ箱に移動しました（PowerShell経由）"
            else
              echo "❌ '$item' をゴミ箱に移動できませんでした"
              if [[ "$force" == false ]]; then
                return 1
              fi
            fi
          else
            # ファイルの場合
            powershell.exe -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('$winpath', 'OnlyErrorDialogs', 'SendToRecycleBin')" 2>/dev/null
            if [ $? -eq 0 ]; then
              echo "🗑️ '$item' をゴミ箱に移動しました（PowerShell経由）"
            else
              echo "❌ '$item' をゴミ箱に移動できませんでした"
              if [[ "$force" == false ]]; then
                return 1
              fi
            fi
          fi
        else
          echo "❌ Error: PowerShell not found"
          return 1
        fi
      fi
    else
      # Linux - use trash-cli
      if command -v trash-put >/dev/null 2>&1; then
        if trash-put "$item" 2>/dev/null; then
          echo "🗑️ '$item' をゴミ箱に移動しました"
        else
          echo "❌ '$item' をゴミ箱に移動できませんでした"
          if [[ "$force" == false ]]; then
            return 1
          fi
        fi
      elif command -v trash-cli >/dev/null 2>&1; then
        if trash-cli "$item"; then
          echo "🗑️ '$item' をゴミ箱に移動しました"
        else
          echo "❌ '$item' をゴミ箱に移動できませんでした"
          if [[ "$force" == false ]]; then
            return 1
          fi
        fi
      elif command -v trash >/dev/null 2>&1; then
        if command trash "$item"; then
          echo "🗑️ '$item' をゴミ箱に移動しました"
        else
          echo "❌ '$item' をゴミ箱に移動できませんでした"
          if [[ "$force" == false ]]; then
            return 1
          fi
        fi
      else
        echo "❌ Error: trash command not found"
        echo "💡 Install trash-cli:"
        echo "    sudo apt install trash-cli"
        return 1
      fi
    fi
  done
}

# trash関数が定義されたので、rmコマンドのエイリアスを設定
# alias rm='trash'  # このエイリアスはaliases.zshで設定します 
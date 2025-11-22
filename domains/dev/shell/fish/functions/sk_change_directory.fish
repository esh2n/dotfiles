function sk_change_directory --description "Change directory with zoxide and Skim"
    if not type -q zoxide
        echo "Error: zoxide not found"
        return 1
    end

    set -l exclude_pattern '(^\.|/\.|\.Trash|OrbStack|\.cache|\.aws|\.devin|config/claude|\.vscode|__pycache__|node_modules|vendor|\.idea|build|dist|target|\.next|\.nuxt|coverage|\.pytest_cache|\.mypy_cache|venv|\.venv|Library/Caches|Library/Logs|\.npm|\.yarn|\.pnpm)'
    
    set -l selected_dir (zoxide query -l | grep -v -E "$exclude_pattern" | sk --ansi --reverse --height '50%')

    if test -n "$selected_dir"
        cd "$selected_dir"
        commandline -f repaint
    end
end

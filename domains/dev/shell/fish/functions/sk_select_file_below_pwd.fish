function sk_select_file_below_pwd --description "Select file below current directory"
    # Check if in ghq path
    if not string match -q "*$(ghq root)*" (pwd)
        echo "you are not in ghq path"
        return 0
    end

    set -l selected_path (fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor 2>/dev/null | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}' 2>/dev/null)

    if test -n "$selected_path"
        if test -f "$selected_path"
            nvim "$selected_path"
            set -l dir_path (dirname "$selected_path")
            cd "$dir_path"
            echo "✓ Moved to: $dir_path"
        end
    end
end

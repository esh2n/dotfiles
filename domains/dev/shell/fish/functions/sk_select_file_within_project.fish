function sk_select_file_within_project --description "Select file within current project"
    set -l base_path (pwd | grep -o "$(ghq root)/[^/]*/[^/]*/[^/]*")
    
    if test -z "$base_path"
        echo "you are not in ghq project"
        return 0
    end

    set -l paths (fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor . "$base_path" 2>/dev/null)

    if test -n "$paths"
        set -l selected_path (echo -e "(root)\n$paths" | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {} 2>/dev/null || echo "Preview not available"' 2>/dev/null)

        if test -n "$selected_path"
            if test "$selected_path" = "(root)"
                cd "$base_path"
                echo "✓ Moved to: $base_path"
                return 0
            end
            
            if test -f "$selected_path"
                nvim "$selected_path"
                set -l dir_path (dirname "$selected_path")
                cd "$dir_path"
                echo "✓ Moved to: $dir_path"
            else if test -d "$selected_path"
                cd "$selected_path"
                echo "✓ Moved to: $selected_path"
            end
        end
    else
        echo "No files found in project"
    end
end

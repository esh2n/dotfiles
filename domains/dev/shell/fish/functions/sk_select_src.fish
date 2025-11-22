function sk_select_src --description "Select project from ghq list"
    if not type -q ghq
        echo "Error: ghq not found"
        return 1
    end

    if not type -q sk
        echo "Error: sk not found"
        return 1
    end

    # pacifica support if available
    set -l folder_icon \uF07C
    set -l selected_dir ""

    if type -q pacifica
        set selected_dir (pacifica | grep "/github\.com/" | sed "s/^/$folder_icon /" | sk --ansi --reverse --height '100%' --query (commandline) | sed "s/^$folder_icon //")
    else
        set selected_dir (ghq list -p | sk --ansi --reverse --height '50%' --query (commandline))
    end

    if test -n "$selected_dir"
        cd "$selected_dir"
        commandline -f repaint
    end
end

function sk_select_history --description "Search history with Skim"
    set -l query (commandline)
    
    if test -n "$query"
        set query "--query=$query"
    end

    history | sk --ansi --reverse --height '50%' $query | read -l selected

    if test -n "$selected"
        commandline "$selected"
    end
    commandline -f repaint
end

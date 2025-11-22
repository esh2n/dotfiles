function mkcd --description "Create a directory and change into it"
    if test (count $argv) -eq 0
        echo "❌ Error: Directory name required"
        echo "Usage: mkcd <directory>"
        return 1
    end

    for dir in $argv
        if test -d "$dir"
            echo "⚠️  Directory '$dir' already exists"
            read -P "➡️  Change to this directory? [Y/n]: " response
            switch $response
                case n N
                    continue
                case '*'
                    cd "$dir"
                    echo "✅ Changed to '$dir'"
                    return 0
            end
        else
            mkdir -p "$dir" 2>/dev/null
            if test $status -eq 0
                echo "✨ Created directory '$dir'"
                cd "$dir"
                echo "✅ Changed to '$dir'"
                return 0
            else
                echo "❌ Error: Failed to create '$dir'"
                echo "💡 Check directory permissions"
                return 1
            end
        end
    end
end

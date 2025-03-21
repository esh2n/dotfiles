function open --description 'Cross-platform open command (works in macOS, Linux, and WSL)'
    # Check if arguments were provided
    if test (count $argv) -eq 0
        echo "❌ Error: Missing argument"
        echo "Usage: open <file or URL>"
        return 1
    end

    set -l target $argv[1]
    
    # Detect platform and use appropriate command
    switch (uname)
        case Darwin
            # macOS - use native open command
            command open $argv
        case Linux
            # Check if running in WSL
            if test -f /proc/version; and grep -q Microsoft /proc/version
                # WSL - try wslview, then explorer.exe as fallback
                if type -q wslview
                    wslview $target
                else
                    # Convert path to Windows format if it's a file path
                    if test -e $target
                        set winpath (wslpath -w $target)
                        explorer.exe $winpath
                    else
                        # If it's a URL or doesn't exist as a file, pass directly
                        explorer.exe $target
                    end
                    echo "💡 Tip: Install wslu package for better Windows integration:"
                    echo "    sudo apt install wslu"
                end
            else
                # Regular Linux - use xdg-open
                if type -q xdg-open
                    xdg-open $target
                else
                    echo "❌ Error: No suitable 'open' command found"
                    echo "💡 Install xdg-utils package:"
                    echo "    sudo apt install xdg-utils"
                    return 1
                end
            end
    end
end
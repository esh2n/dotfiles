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
                # WSL - handle with special care
                
                # Check for directory specifically
                if test -d "$target"
                    # Directory handling in WSL
                    if type -q wslview
                        # Use wslview for directories (best option)
                        wslview "$target"
                    else if type -q wslpath
                        # Convert path to Windows and use explorer directly
                        set winpath (wslpath -w "$target")
                        explorer.exe "$winpath"
                    else
                        # Last resort - just try explorer with path
                        explorer.exe "$target"
                        echo "⚠️ Warning: For better directory handling, install wslu:"
                        echo "    sudo apt install -y wslu"
                    end
                else
                    # Files and URLs handling
                    if type -q wslview
                        wslview "$target"
                    else
                        # Convert path to Windows format if it's a file path
                        if test -e "$target"
                            set winpath (wslpath -w "$target")
                            explorer.exe "$winpath"
                        else
                            # If it's a URL or doesn't exist as a file, pass directly
                            explorer.exe "$target"
                        end
                        echo "💡 Tip: Install wslu package for better Windows integration:"
                        echo "    sudo apt install -y wslu"
                    end
                end
                
                # Check for locale issues and provide helpful message
                if locale 2>&1 | grep -q "warning: Setting locale failed"
                    echo ""
                    echo "⚠️ Locale Warning: You have locale issues in your WSL environment."
                    echo "📝 Run the utility setup script to resolve these warnings:"
                    echo "    sh ~/go/github.com/esh2n/dotfiles/wsl-utils-setup.sh"
                end
            else
                # Regular Linux - use xdg-open
                if type -q xdg-open
                    xdg-open "$target"
                    
                    # Check for specific directory error
                    if test $status -ne 0; and test -d "$target"
                        echo "⚠️ Warning: xdg-open failed to open directory."
                        echo "💡 Install desktop-file-utils and required applications:"
                        echo "    sudo apt install -y desktop-file-utils xdg-utils"
                        echo "    sudo update-desktop-database"
                        
                        # Try to fall back to a file manager if available
                        for fm in nautilus thunar dolphin pcmanfm caja nemo
                            if type -q $fm
                                echo "🔄 Trying to open with $fm instead..."
                                $fm "$target"
                                return $status
                            end
                        end
                    end
                else
                    echo "❌ Error: No suitable 'open' command found"
                    echo "💡 Install xdg-utils package:"
                    echo "    sudo apt install -y xdg-utils"
                    return 1
                end
            end
    end
end
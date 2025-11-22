function nerd_fonts --description "Install Nerd Fonts"
    set -l font_name $argv[1]
    if test -z "$font_name"
        echo "Usage: nerd_fonts <font_name>"
        return 1
    end

    git clone --branch=master --depth 1 https://github.com/ryanoasis/nerd-fonts.git
    cd nerd-fonts
    ./install.sh "$font_name"
    cd ..
    rm -rf nerd-fonts
end

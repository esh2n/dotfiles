function fish_prompt
    # This is just a fallback in case starship fails
    if not type -q starship
        set_color blue
        echo -n (prompt_pwd)
        set_color normal
        echo -n ' > '
    end
end 
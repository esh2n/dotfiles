# iTerm2 tab color configuration
echo -e "\033]6;1;bg;red;brightness;53\a"
echo -e "\033]6;1;bg;green;brightness;58\a"
echo -e "\033]6;1;bg;blue;brightness;68\a"

# Prompt configuration
export PROMPT="
%F{green}[%~]%f <`git config user.name`>
=> %# "
RPROMPT='%*' 
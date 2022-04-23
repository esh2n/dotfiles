# zmodload zsh/zprof && zprof

export ZSHHOME="${HOME}/.zsh"
if [ -d $ZSHHOME -a -r $ZSHHOME -a -x $ZSHHOME ]; then
  source $ZSHHOME/init/brew_init.zsh
    for i in $ZSHHOME/*; do
        [[ ${i##*/} = *.zsh ]] &&
            [ \( -f $i -o -h $i \) -a -r $i ] && . $i
    done
fi
eval "$(starship init zsh)"

# if (which zprof > /dev/null 2>&1) ;then
#   zprof
# fi
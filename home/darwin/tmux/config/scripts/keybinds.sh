#!/usr/bin/env bash

# Key bindings help script for tmux status bar
# Prefix: Ctrl+q

get_icon() {
    echo "ℹ"
}

get_help() {
    cat << 'EOF'
┌───────────────────────────────────────────────┐
│  tmux Keybindings (Prefix: Ctrl+q)            │
├───────────────────────────────────────────────┤
│  Pane                                         │
│    C-h/j/k/l       Navigate (vim-tmux)        │
│    Prefix + \       Split horizontal           │
│    Prefix + -       Split vertical             │
│    Prefix + H/J/K/L Resize                     │
│    Prefix + z       Zoom toggle                │
│    Prefix + x       Close pane                 │
├───────────────────────────────────────────────┤
│  Window                                       │
│    Alt+h / Alt+l    Prev / Next window         │
│    Prefix + Tab     Last window                │
├───────────────────────────────────────────────┤
│  Session                                      │
│    Prefix + d       Detach                     │
│    Prefix + C-c     New session                │
│    Prefix + o       Session picker (sessionx)  │
├───────────────────────────────────────────────┤
│  Floating                                     │
│    Prefix + f / F   Float pane / Menu (floax)  │
│    Prefix + e       Floating nvim              │
│    Prefix + g       Floating lazygit           │
├───────────────────────────────────────────────┤
│  Tools                                        │
│    Prefix + t       Thumbs (hint copy)         │
│    Prefix + X       Extrakto (fzf text)        │
│    Prefix + /       tmux-fzf                   │
│    Prefix + w       Jump (EasyMotion)          │
│    Prefix + Space   Which-key                  │
├───────────────────────────────────────────────┤
│  Copy Mode                                    │
│    Prefix + [ or Enter  Enter copy mode        │
│    v / y                Select / Copy          │
├───────────────────────────────────────────────┤
│  Spotify                                      │
│    Prefix + s       Toggle play/pause          │
│    Prefix + n / N   Next / Prev track          │
└───────────────────────────────────────────────┘
EOF
}

case "${1:-icon}" in
    "icon") get_icon ;;
    "help") get_help ;;
    *) get_icon ;;
esac

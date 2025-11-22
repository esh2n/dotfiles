# Update keybindings to include file selection
function fish_user_key_bindings
    bind \cr sk_select_history
    bind \cg sk_change_directory
    bind \c] sk_select_src
    bind \cp sk_select_src
    bind \cb sk_select_file_below_pwd
    bind \cv sk_select_file_within_project
end

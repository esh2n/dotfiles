# Zsh Initialization

# 1. Common Aliases
source "${0:A:h}/../common/aliases.sh"

# 2. Options & Functions
source "${0:A:h}/options.zsh"
source "${0:A:h}/utils.zsh"
source "${0:A:h}/functions.zsh"

# 3. Integrations (Tools)
source "${0:A:h}/integrations.zsh"

# 4. Zsh Specific Aliases
source "${0:A:h}/aliases.zsh"

# 5. Keybindings (Must be last)
source "${0:A:h}/keybindings.zsh"

# 6. Editors
source "${0:A:h}/editors.zsh"

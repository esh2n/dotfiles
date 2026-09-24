# shellcheck shell=bash
# Sourced by the headless launchers (litellm-up.sh, proxy-key.sh,
# jig-decision-up.sh): how a process with no terminal reaches 1Password.
#
# The 1Password service-account token lives in the OS's own store, read with
# no prompt: the login Keychain on macOS, the Secret Service (libsecret,
# gnome-keyring on Omarchy) on Linux. Store it once per machine:
#   macOS: security add-generic-password -a "$USER" -s litellm-op-token -w '<token>'
#   Linux: secret-tool store --label='1Password service account' service litellm-op-token

# launchd and systemd hand services a minimal PATH; name the tools' real
# locations: nix-darwin's per-user profile, standalone home-manager's profile,
# Homebrew, then the system. DOTFILES_SERVICE_PATH replaces the list whole
# (tests put their stand-ins there).
export PATH="${DOTFILES_SERVICE_PATH:-/etc/profiles/per-user/$(id -un)/bin:${HOME}/.nix-profile/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin}"

OP_TOKEN_ITEM="litellm-op-token"

# export_op_token: put the service-account token in OP_SERVICE_ACCOUNT_TOKEN,
# or stop the launch saying how to store it.
export_op_token() {
  local token=""
  case "$(uname -s)" in
  Darwin) token="$(security find-generic-password -s "${OP_TOKEN_ITEM}" -w 2>/dev/null || true)" ;;
  Linux) token="$(secret-tool lookup service "${OP_TOKEN_ITEM}" 2>/dev/null || true)" ;;
  esac
  if [ -z "${token}" ]; then
    echo "${0##*/}: no 1Password service-account token in the OS store (${OP_TOKEN_ITEM})." >&2
    echo "  macOS: security add-generic-password -a \"\$USER\" -s ${OP_TOKEN_ITEM} -w '<token>'" >&2
    echo "  Linux: secret-tool store --label='1Password service account' service ${OP_TOKEN_ITEM}" >&2
    exit 1
  fi
  OP_SERVICE_ACCOUNT_TOKEN="${token}"
  export OP_SERVICE_ACCOUNT_TOKEN
}

# read_secret <op://ref>: `op read` with one retry on empty. A cold-start shell
# intermittently returns an empty value on the first read (measured), and an
# empty key boots a service that 401s every request. Retry once, then abort so
# the service manager retries the whole launch. Call it inside $(); set -e in
# the caller turns the exit into a launch abort.
read_secret() {
  local ref="$1" value
  value="$(timeout 60 op read "${ref}" 2>/dev/null || true)"
  if [ -z "${value}" ]; then
    sleep 2
    value="$(timeout 60 op read "${ref}" 2>/dev/null || true)"
  fi
  if [ -z "${value}" ]; then
    echo "${0##*/}: could not resolve ${ref} (empty after retry)" >&2
    exit 1
  fi
  printf '%s' "${value}"
}

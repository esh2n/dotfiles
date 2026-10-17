package main

import (
	"fmt"
	"strings"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/setup"
)

// isHelp is whether an argument asks for the usage text.
func isHelp(arg string) bool {
	return arg == "help" || arg == "-h" || arg == "--help"
}

// helpFor is the usage text of one command, the general one when the
// command has none of its own.
func helpFor(command string) string {
	switch command {
	case "llm":
		return llmUsage
	case "mado":
		return madoUsage
	case "wallpaper":
		return wallpaperUsage
	case "records":
		return recordsUsage
	case "setup":
		return setupUsage()
	case "service":
		return serviceUsage
	case "pstack":
		return pstackUsage
	default:
		return usage
	}
}

const pstackUsage = `usage: dotctl pstack [--repo DIR] setup           fetch the pinned plugin, generate ~/.claude-pstack (idempotent)
       dotctl pstack [--repo DIR] run [claude args]  start Claude Code in the pstack profile with the plugin loaded
       dotctl pstack [--repo DIR] status             the pin, the checkout and the evaluation log

The pin is harness/profiles/pstack/upstream.json; the rules profile is
harness/profiles/pstack/ (rules/decisions/2026-10-17-pstack-evaluation-profile.md).
`

func setupUsage() string {
	return fmt.Sprintf("usage: dotctl setup [--repo DIR] <step>\nsteps: %s\n", strings.Join(setup.Names(), ", "))
}

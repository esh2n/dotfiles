// dotctl is the dotfiles' own CLI (rules/decisions/2026-09-25-dotctl-in-go.md):
// one binary, one subcommand per job the shell scripts used to do.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/nvim"
)

const usage = `usage: dotctl <command> [args]

commands:
  up [--repo DIR]                        install or update this machine (what make up runs)
  setup [--repo DIR] <step>              one setup step Nix cannot declare (activation runs them)
  nvim <custom|nvchad|lazyvim|astrovim>  point ~/.config/nvim at a distribution
  nvim current                           name the active distribution
  nvim list                              list distributions, marking the active one
  mado [use|stop|status|list|layout|info]  switch the macOS window-manager profile (also: mado)
  theme [--repo DIR] list|current|init|set <name>
                                         switch the colour theme (one link, then reloads)
  cache-gc [--force] [--dry-run] [--quiet] [--touch REPO]
                                         keep Codebase-Memory's indexes within age and size
                                         (also installed as code-graph-cache-gc)
`

func main() {
	args := os.Args[1:]
	// Installed under old command names too; the name picks the command.
	switch filepath.Base(os.Args[0]) {
	case "code-graph-cache-gc":
		args = append([]string{"cache-gc"}, args...)
	case "nvim-switch":
		args = append([]string{"nvim"}, args...)
	case "mado":
		args = append([]string{"mado"}, args...)
	case "theme-switch":
		if len(args) == 0 {
			args = []string{"theme", "list"}
		} else {
			args = append([]string{"theme", "set"}, args...)
		}
	}
	os.Exit(run(args, os.Stdout, os.Stderr))
}

func run(args []string, out, errOut io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(errOut, usage)
		return 2
	}
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(errOut, "dotctl:", err)
		return 1
	}
	switch args[0] {
	case "nvim":
		return runNvim(home, args[1:], out, errOut)
	case "up":
		return runUp(home, args[1:], out, errOut)
	case "setup":
		return runSetup(home, args[1:], out, errOut)
	case "mado":
		return runMado(home, args[1:], out, errOut)
	case "theme":
		return runTheme(home, args[1:], out, errOut)
	case "cache-gc":
		return runCacheGC(home, args[1:], nil, out, errOut)
	case "help", "-h", "--help":
		fmt.Fprint(out, usage)
		return 0
	default:
		fmt.Fprintf(errOut, "dotctl: unknown command %q\n%s", args[0], usage)
		return 2
	}
}

func runNvim(home string, args []string, out, errOut io.Writer) int {
	if len(args) != 1 {
		fmt.Fprint(errOut, usage)
		return 2
	}
	switch args[0] {
	case "current":
		fmt.Fprintln(out, nvim.Current(home))
	case "list":
		cur := nvim.Current(home)
		for _, d := range nvim.Distributions {
			mark := "  "
			if d == cur {
				mark = "* "
			}
			fmt.Fprintln(out, mark+d)
		}
	default:
		if err := nvim.Switch(home, args[0], time.Now()); err != nil {
			fmt.Fprintln(errOut, "dotctl nvim:", err)
			return 1
		}
		fmt.Fprintln(out, "switched to nvim-"+args[0])
	}
	return 0
}

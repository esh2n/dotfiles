// dotctl is the dotfiles' own CLI (rules/decisions/2026-09-25-dotctl-in-go.md):
// one binary, one subcommand per job the shell scripts used to do.
package main

import (
	"fmt"
	"io"
	"os"
	"time"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/nvim"
)

const usage = `usage: dotctl <command> [args]

commands:
  nvim <custom|nvchad|lazyvim|astrovim>  point ~/.config/nvim at a distribution
  nvim current                           name the active distribution
  nvim list                              list distributions, marking the active one
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
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

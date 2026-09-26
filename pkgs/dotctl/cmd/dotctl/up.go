package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/up"
)

// runUp is `dotctl up [--repo DIR]`, what `make up` runs once Nix exists.
func runUp(home string, args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("up", flag.ContinueOnError)
	fs.SetOutput(errOut)
	repo := fs.String("repo", os.Getenv("DOTFILES_ROOT"), "the checkout (default $DOTFILES_ROOT)")
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 {
		return 2
	}
	if *repo == "" {
		fmt.Fprintln(errOut, "dotctl up: the checkout is unknown; pass --repo or set DOTFILES_ROOT")
		return 2
	}
	// facts.nix reads the checkout from DOTFILES_ROOT during evaluation
	_ = os.Setenv("DOTFILES_ROOT", *repo)
	p := ui.Printer{Out: out, Err: errOut, Prefix: "up"}
	c := up.Config{
		Home:      home,
		Repo:      *repo,
		User:      os.Getenv("USER"),
		Shell:     os.Getenv("SHELL"),
		RolesFile: os.Getenv("DOTFILES_ROLES_FILE"),
		FindZsh:   func() string { p, _ := exec.LookPath("zsh"); return p },
		Log:       func(s string) { p.Note("%s", s) },
		Warn:      func(s string) { p.Warn("%s", s) },
	}
	if err := up.Run(sys.OS{}, c); err != nil {
		p.Error("%v", err)
		return 1
	}
	return 0
}

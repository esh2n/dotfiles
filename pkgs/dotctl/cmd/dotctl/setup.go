package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/setup"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// runSetup is `dotctl setup [--repo DIR] <step>`: one setup step that Nix
// cannot declare (activation runs them; lib/mk-setup.nix).
func runSetup(home string, args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	fs.SetOutput(errOut)
	repo := fs.String("repo", os.Getenv("DOTFILES_ROOT"), "the checkout (default $DOTFILES_ROOT)")
	if err := fs.Parse(args); err != nil || fs.NArg() != 1 {
		fmt.Fprint(errOut, setupUsage())
		return 2
	}
	if *repo == "" {
		fmt.Fprintln(errOut, "dotctl setup: the checkout is unknown; pass --repo or set DOTFILES_ROOT")
		return 2
	}
	name := fs.Arg(0)
	p := ui.Printer{Out: out, Err: errOut, Prefix: "setup"}.With(name)
	err := setup.Run(setup.Env{Home: home, Repo: *repo, Sys: sys.OS{}, UI: p}, name)
	switch {
	case errors.Is(err, setup.ErrUnknownStep):
		ui.Printer{Err: errOut, Prefix: "setup"}.Error("%v", err)
		return 2
	case err != nil:
		p.Error("%v", err)
		return 1
	}
	return 0
}

package main

import (
	"flag"
	"io"
	"os"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/retire"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// runRetire is `dotctl retire-old-layout [--repo DIR]`, run once by
// adopt-mac.sh (internal/retire).
func runRetire(home string, args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("retire-old-layout", flag.ContinueOnError)
	fs.SetOutput(errOut)
	repo := fs.String("repo", os.Getenv("DOTFILES_ROOT"), "the checkout (default $DOTFILES_ROOT)")
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 {
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "retire"}
	if *repo == "" {
		p.Error("the checkout is unknown; pass --repo or set DOTFILES_ROOT")
		return 2
	}
	c := retire.Config{Home: home, Repo: *repo,
		Log:  func(s string) { p.Note("%s", s) },
		Warn: func(s string) { p.Warn("%s", s) },
	}
	if err := retire.Run(c); err != nil {
		p.Error("%v", err)
		return 1
	}
	return 0
}

package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/theme"
)

// defaultTheme is used when nothing has been chosen on this machine yet.
const defaultTheme = "catppuccin"

func themeEnv(home, repo string, errOut io.Writer) theme.Env {
	return theme.Env{
		Home: home,
		Repo: repo,
		Run: func(cmd ...string) error {
			c := exec.Command(cmd[0], cmd[1:]...)
			c.Stdout, c.Stderr = io.Discard, io.Discard
			return c.Run()
		},
		Start: func(cmd ...string) error {
			c := exec.Command(cmd[0], cmd[1:]...)
			if err := c.Start(); err != nil {
				return err
			}
			return c.Process.Release()
		},
		Has:  func(cmd string) bool { _, err := exec.LookPath(cmd); return err == nil },
		Warn: func(msg string) { fmt.Fprintln(errOut, "dotctl theme: warning:", msg) },
	}
}

// runTheme is `dotctl theme [--repo DIR] list|current|init|set <name>`.
func runTheme(home string, args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("theme", flag.ContinueOnError)
	fs.SetOutput(errOut)
	repo := fs.String("repo", os.Getenv("DOTFILES_ROOT"), "the checkout (default $DOTFILES_ROOT)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	rest := fs.Args()
	if len(rest) == 0 {
		fmt.Fprint(errOut, usage)
		return 2
	}
	if *repo == "" {
		fmt.Fprintln(errOut, "dotctl theme: the checkout is unknown; pass --repo or set DOTFILES_ROOT")
		return 2
	}
	e := themeEnv(home, *repo, errOut)
	fail := func(err error) int {
		fmt.Fprintln(errOut, "dotctl theme:", err)
		return 1
	}
	switch {
	case rest[0] == "list" && len(rest) == 1:
		names, err := theme.List(e)
		if err != nil {
			return fail(err)
		}
		cur, _ := theme.Current(e)
		for _, n := range names {
			mark := "  "
			if n == cur {
				mark = "* "
			}
			fmt.Fprintln(out, mark+n)
		}
	case rest[0] == "current" && len(rest) == 1:
		cur, err := theme.Current(e)
		if err != nil {
			return fail(err)
		}
		fmt.Fprintln(out, cur)
	case rest[0] == "init" && len(rest) == 1:
		if err := theme.Init(e, defaultTheme); err != nil {
			return fail(err)
		}
	case rest[0] == "set" && len(rest) == 2:
		if err := theme.Set(e, rest[1]); err != nil {
			return fail(err)
		}
		fmt.Fprintln(out, "theme:", rest[1])
	default:
		fmt.Fprint(errOut, usage)
		return 2
	}
	return 0
}

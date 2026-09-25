package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/up"
)

// osSys is the real machine for `dotctl up`.
type osSys struct{}

func (osSys) Run(env []string, name string, args ...string) error {
	c := exec.Command(name, args...)
	c.Stdin, c.Stdout, c.Stderr = os.Stdin, os.Stdout, os.Stderr // sudo may ask
	if len(env) > 0 {
		c.Env = withEnv(os.Environ(), env)
	}
	return c.Run()
}

// withEnv applies "K=v" (set) and "K=" (remove) to base.
func withEnv(base, changes []string) []string {
	out := base
	for _, ch := range changes {
		key, val, _ := strings.Cut(ch, "=")
		kept := out[:0:0]
		for _, e := range out {
			if !strings.HasPrefix(e, key+"=") {
				kept = append(kept, e)
			}
		}
		if val != "" {
			kept = append(kept, ch)
		}
		out = kept
	}
	return out
}

func (osSys) Output(name string, args ...string) (string, error) {
	c := exec.Command(name, args...)
	c.Stderr = os.Stderr
	out, err := c.Output()
	return string(out), err
}

func (osSys) Has(name string) bool { _, err := exec.LookPath(name); return err == nil }
func (osSys) OS() string           { return runtime.GOOS }

func (osSys) Shells() string {
	b, _ := os.ReadFile("/etc/shells")
	return string(b)
}

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
	c := up.Config{
		Home:      home,
		Repo:      *repo,
		User:      os.Getenv("USER"),
		Shell:     os.Getenv("SHELL"),
		RolesFile: os.Getenv("DOTFILES_ROLES_FILE"),
		FindZsh:   func() string { p, _ := exec.LookPath("zsh"); return p },
		Log:       func(s string) { fmt.Fprintln(out, "up:", s) },
		Warn:      func(s string) { fmt.Fprintln(errOut, "up: warning:", s) },
	}
	if err := up.Run(osSys{}, c); err != nil {
		fmt.Fprintln(errOut, "up:", err)
		return 1
	}
	return 0
}

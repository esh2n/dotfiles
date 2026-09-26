// Package gh is dotctl's GitHub CLI helpers: switching between the accounts
// `gh auth` holds (was gh-switch) and upgrading the pr-graph extension on
// purpose rather than on every rebuild (was gh-pr-graph-update).
package gh

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// Sys is the machine. sys.OS is the real one.
type Sys interface {
	Exec(c sys.Cmd) (string, string, error)
	Run(env []string, name string, args ...string) error
	Has(name string) bool
}

// Account is one login `gh auth status` reports.
type Account struct {
	Name   string
	Active bool
}

var loggedIn = regexp.MustCompile(`Logged in to github\.com account (\S+)`)

// Accounts reads `gh auth status` output: each "Logged in to github.com
// account NAME" line, active when a following "Active account: true" comes
// before the next account.
func Accounts(status string) []Account {
	var out []Account
	for _, line := range strings.Split(status, "\n") {
		if m := loggedIn.FindStringSubmatch(line); m != nil {
			out = append(out, Account{Name: m[1]})
			continue
		}
		if len(out) > 0 && strings.Contains(line, "Active account: true") {
			out[len(out)-1].Active = true
		}
	}
	return out
}

// Switch lists the accounts, asks for a number on in, and switches to it.
func Switch(s Sys, p ui.Printer, in io.Reader) error {
	if !s.Has("gh") {
		return errors.New("gh is not installed")
	}
	// gh auth status prints to stderr
	out, errOut, _ := s.Exec(sys.Cmd{Name: "gh", Args: []string{"auth", "status"}, Timeout: 30 * time.Second})
	accounts := Accounts(out + errOut)
	if len(accounts) == 0 {
		return errors.New("no authenticated GitHub accounts; run 'gh auth login' to add one")
	}
	p.Note("GitHub accounts")
	for i, a := range accounts {
		mark := ""
		if a.Active {
			mark = " (current)"
		}
		fmt.Fprintf(p.Out, "%d) %s%s\n", i+1, a.Name, mark)
	}
	fmt.Fprint(p.Out, "Select account number: ")
	line, _ := bufio.NewReader(in).ReadString('\n')
	n, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || n < 1 || n > len(accounts) {
		return fmt.Errorf("invalid selection %q", strings.TrimSpace(line))
	}
	chosen := accounts[n-1]
	if chosen.Active {
		p.Note("already using %s", chosen.Name)
		return nil
	}
	if err := s.Run(nil, "gh", "auth", "switch", "-u", chosen.Name); err != nil {
		return fmt.Errorf("gh auth switch -u %s: %w", chosen.Name, err)
	}
	p.Note("switched to %s", chosen.Name)
	return nil
}

// UpgradePRGraph upgrades the pr-graph extension. Upgrades are deliberately
// explicit rather than part of a dotfiles rebuild.
func UpgradePRGraph(s Sys) error {
	if !s.Has("gh") {
		return errors.New("gh is not installed")
	}
	list, _, _ := s.Exec(sys.Cmd{Name: "gh", Args: []string{"extension", "list"}, Timeout: 30 * time.Second})
	if !strings.Contains(list, "orangain/gh-pr-graph") {
		return errors.New("gh-pr-graph is not installed; make up installs it (dotctl setup gh-extensions)")
	}
	return s.Run(nil, "gh", "extension", "upgrade", "pr-graph")
}

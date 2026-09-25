package gh

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/ui"
)

type fakeSys struct {
	status, list string
	noGH         bool
	runErr       error
	ran          []string
}

func (f *fakeSys) Exec(c sys.Cmd) (string, string, error) {
	switch strings.Join(c.Args, " ") {
	case "auth status":
		return "", f.status, nil
	case "extension list":
		return f.list, "", nil
	}
	return "", "", nil
}

func (f *fakeSys) Run(_ []string, name string, args ...string) error {
	f.ran = append(f.ran, name+" "+strings.Join(args, " "))
	return f.runErr
}

func (f *fakeSys) Has(string) bool { return !f.noGH }

const status = `github.com
  ✓ Logged in to github.com account work-me (keyring)
  - Active account: false
  - Git operations protocol: https
  ✓ Logged in to github.com account esh2n (keyring)
  - Active account: true
`

func TestAccountsFindsTheActiveOne(t *testing.T) {
	got := Accounts(status)
	if len(got) != 2 || got[0] != (Account{"work-me", false}) || got[1] != (Account{"esh2n", true}) {
		t.Fatalf("got %+v", got)
	}
}

func TestSwitchChoosesByNumber(t *testing.T) {
	f := &fakeSys{status: status}
	var out bytes.Buffer
	p := ui.Printer{Out: &out, Err: &out, Prefix: "gh switch"}
	if err := Switch(f, p, strings.NewReader("1\n")); err != nil {
		t.Fatal(err)
	}
	if len(f.ran) != 1 || f.ran[0] != "gh auth switch -u work-me" {
		t.Fatalf("ran %v", f.ran)
	}
	if !strings.Contains(out.String(), "2) esh2n (current)") || !strings.Contains(out.String(), "switched to work-me") {
		t.Fatalf("out %q", out.String())
	}
	f.ran = nil
	if err := Switch(f, p, strings.NewReader("2\n")); err != nil || len(f.ran) != 0 {
		t.Fatalf("the current account: %v %v", err, f.ran)
	}
	for _, bad := range []string{"0\n", "3\n", "x\n", ""} {
		if err := Switch(f, p, strings.NewReader(bad)); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
	f.runErr = errors.New("exit status 1")
	if err := Switch(f, p, strings.NewReader("1\n")); err == nil {
		t.Fatal("a failed switch is not an error")
	}
}

func TestSwitchWithoutGhOrAccounts(t *testing.T) {
	p := ui.Printer{}
	if err := Switch(&fakeSys{noGH: true}, p, strings.NewReader("")); err == nil {
		t.Fatal("no gh")
	}
	if err := Switch(&fakeSys{}, p, strings.NewReader("")); err == nil || !strings.Contains(err.Error(), "gh auth login") {
		t.Fatalf("no accounts: %v", err)
	}
}

func TestUpgradePRGraph(t *testing.T) {
	f := &fakeSys{list: "gh pr-graph  orangain/gh-pr-graph  v1\n"}
	if err := UpgradePRGraph(f); err != nil || f.ran[0] != "gh extension upgrade pr-graph" {
		t.Fatalf("%v %v", err, f.ran)
	}
	if err := UpgradePRGraph(&fakeSys{}); err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("missing extension: %v", err)
	}
	if err := UpgradePRGraph(&fakeSys{noGH: true}); err == nil {
		t.Fatal("no gh")
	}
}

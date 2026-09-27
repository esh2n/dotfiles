package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/records"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

const recordsUsage = `usage: dotctl records [--repo DIR] check|prune [--yes]
  check        list the flow documents (research records, plans) past their 14 days
  prune        list them; with --yes, remove them and their research INDEX lines
Promote what lasts first (the records-triage skill); prune removes the rest.
`

// runRecords is `dotctl records`: the flow documents' TTL, checked and
// enforced (harness/rules/decisions/2026-09-27-records-flow-and-stock.md).
func runRecords(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("records", flag.ContinueOnError)
	fs.SetOutput(errOut)
	repo := fs.String("repo", os.Getenv("DOTFILES_ROOT"), "the checkout (default $DOTFILES_ROOT)")
	if err := fs.Parse(args); err != nil || fs.NArg() < 1 {
		fmt.Fprint(errOut, recordsUsage)
		return 2
	}
	if *repo == "" {
		fmt.Fprintln(errOut, "dotctl records: the checkout is unknown; pass --repo or set DOTFILES_ROOT")
		return 2
	}
	cmd, rest := fs.Arg(0), fs.Args()[1:]
	yes := len(rest) == 1 && rest[0] == "--yes"
	if (cmd != "check" && cmd != "prune") || (len(rest) > 0 && !(cmd == "prune" && yes)) {
		fmt.Fprint(errOut, recordsUsage)
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "records"}
	expired, err := records.Expired(*repo, time.Now(), records.TTL, gitFirstCommit(*repo))
	if err != nil {
		p.Error("%v", err)
		return 1
	}
	if len(expired) == 0 {
		fmt.Fprintln(out, "no flow document is past its 14 days")
		return 0
	}
	for _, it := range expired {
		fmt.Fprintf(out, "%s  %s\n", it.Date.Format("2006-01-02"), it.Path)
	}
	if cmd == "check" || !yes {
		fmt.Fprintln(out, "promote what lasts with /records-triage, then: dotctl records prune --yes")
		return 0
	}
	if err := records.Prune(*repo, expired); err != nil {
		p.Error("%v", err)
		return 1
	}
	fmt.Fprintf(out, "removed %d; commit the removal in the checkout\n", len(expired))
	return 0
}

// gitFirstCommit dates a checkout path by the commit that added it.
func gitFirstCommit(repo string) records.DateOf {
	return func(rel string) (time.Time, bool) {
		b, err := exec.Command("git", "-C", repo, "log", "--diff-filter=A", "--format=%as", "--reverse", "--", rel).Output()
		if err != nil {
			return time.Time{}, false
		}
		first, _, _ := strings.Cut(strings.TrimSpace(string(b)), "\n")
		d, err := time.Parse("2006-01-02", first)
		return d, err == nil
	}
}

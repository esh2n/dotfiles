package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/llm"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/service"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

const llmUsage = `usage: dotctl llm setup [--repo DIR] [--lmstudio] [--gpu] [--console]
       dotctl llm check [--repo DIR] [--lmstudio] [--gpu] [--console] [--complex]
       dotctl llm use [--repo DIR] <tier> <model>...   point a tier at catalog models (harness/policy/models.json)
`

// runLLM is `dotctl llm setup|check`: the home LLM's command steps (what
// activation runs for the model-provider and observer roles) and its check.
func runLLM(home string, args []string, out, errOut io.Writer) int {
	if len(args) > 0 && args[0] == "use" {
		return runLLMUse(home, args[1:], out, errOut)
	}
	if len(args) == 0 || (args[0] != "setup" && args[0] != "check") {
		fmt.Fprint(errOut, llmUsage)
		return 2
	}
	fs := flag.NewFlagSet("llm "+args[0], flag.ContinueOnError)
	fs.SetOutput(errOut)
	repo := fs.String("repo", os.Getenv("DOTFILES_ROOT"), "the checkout (default $DOTFILES_ROOT)")
	var o llm.Offer
	fs.BoolVar(&o.LMStudio, "lmstudio", false, "this machine serves LM Studio (model-provider on macOS)")
	fs.BoolVar(&o.GPU, "gpu", false, "this machine serves llama-server (model-provider on Linux)")
	fs.BoolVar(&o.Console, "console", false, "this machine is the observer")
	withComplex := fs.Bool("complex", false, "also ask the complex tier (check)")
	if err := fs.Parse(args[1:]); err != nil || fs.NArg() > 0 {
		fmt.Fprint(errOut, llmUsage)
		return 2
	}
	if *repo == "" {
		fmt.Fprintln(errOut, "dotctl llm: the checkout is unknown; pass --repo or set DOTFILES_ROOT")
		return 2
	}
	host, _ := os.Hostname()
	e := llm.Env{
		Home: home, Repo: *repo, Offer: o, Sys: sys.OS{},
		UI:       ui.Printer{Out: out, Err: errOut, Prefix: "home-llm"},
		Hostname: strings.SplitN(host, ".", 2)[0],
		UID:      os.Getuid(),
	}
	check := func(e llm.Env) int {
		return llm.Check(e, &llm.Checker{Out: out, Color: isTerminal(out), Log: checkLog(home)}, *withComplex)
	}
	if args[0] == "check" {
		fails := check(e)
		if fails > 125 {
			fails = 125
		}
		return fails
	}
	todo := llm.Setup(e, check)
	if len(todo) > 0 {
		e.UI.Heading("home-llm: left to do")
		e.UI.List(todo...)
	}
	e.UI.Heading("home-llm: once, by hand")
	e.UI.Steps(llm.Once(e)...)
	return 0
}

// checkLog is where every check's lines are kept, for whoever reads the
// machine later without re-running the probes.
func checkLog(home string) string {
	state := os.Getenv("XDG_STATE_HOME")
	if state == "" {
		state = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(state, "home-llm", "check.log")
}

func isTerminal(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// runLLMUse is `dotctl llm use [--repo DIR] <tier> <model>...`.
func runLLMUse(home string, args []string, out, errOut io.Writer) int {
	repo, rest, ok := repoFlag("llm use", args, errOut)
	if !ok {
		return 2
	}
	if len(rest) < 2 {
		fmt.Fprint(errOut, llmUsage)
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "llm use"}
	e := llm.Env{Home: home, Repo: repo, Sys: sys.OS{}, UI: p}
	restart := func() error {
		return service.Restart(service.Env{Sys: sys.OS{}, UI: p, UID: os.Getuid()}, "litellm-proxy", "http://127.0.0.1:4000/health/liveliness")
	}
	if err := llm.Use(e, rest[0], rest[1:], restart); err != nil {
		p.Error("%v", err)
		return 1
	}
	return 0
}

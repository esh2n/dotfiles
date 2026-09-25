package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/editor"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/gh"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/ledger"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/nvim"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/templates"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/ui"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/wallpaper"
)

// repoFlag parses [--repo DIR] and the rest; the checkout defaults to
// $DOTFILES_ROOT. ok is false after printing why.
func repoFlag(name string, args []string, errOut io.Writer) (repo string, rest []string, ok bool) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(errOut)
	r := fs.String("repo", os.Getenv("DOTFILES_ROOT"), "the checkout (default $DOTFILES_ROOT)")
	if err := fs.Parse(args); err != nil {
		return "", nil, false
	}
	if *r == "" {
		fmt.Fprintf(errOut, "dotctl %s: the checkout is unknown; pass --repo or set DOTFILES_ROOT\n", name)
		return "", nil, false
	}
	return *r, fs.Args(), true
}

// done reports err under the command's prefix and turns it into an exit code.
func done(p ui.Printer, err error) int {
	if err != nil {
		p.Error("%v", err)
		return 1
	}
	return 0
}

// runGH is `dotctl gh switch|pr-graph-update`.
func runGH(args []string, in io.Reader, out, errOut io.Writer) int {
	if len(args) != 1 {
		fmt.Fprint(errOut, "usage: dotctl gh switch|pr-graph-update\n")
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "gh " + args[0]}
	switch args[0] {
	case "switch":
		return done(p, gh.Switch(sys.OS{}, p, in))
	case "pr-graph-update":
		return done(p, gh.UpgradePRGraph(sys.OS{}))
	default:
		fmt.Fprint(errOut, "usage: dotctl gh switch|pr-graph-update\n")
		return 2
	}
}

// runNvimInstall is `dotctl nvim install [--repo DIR]`.
func runNvimInstall(args []string, out, errOut io.Writer) int {
	repo, rest, ok := repoFlag("nvim install", args, errOut)
	if !ok || len(rest) > 0 {
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "nvim install"}
	clone := func(url, dir string) error {
		c := exec.Command("git", "clone", url, dir)
		c.Stdout, c.Stderr = out, errOut
		return c.Run()
	}
	installed, err := nvim.Install(repo, clone)
	if len(installed) > 0 {
		p.Note("installed %s; switch with: dotctl nvim <name>", strings.Join(installed, ", "))
	} else if err == nil {
		p.Note("every distribution is already there")
	}
	return done(p, err)
}

// runEditor is `dotctl editor extensions [--repo DIR]`.
func runEditor(args []string, out, errOut io.Writer) int {
	if len(args) == 0 || args[0] != "extensions" {
		fmt.Fprint(errOut, "usage: dotctl editor extensions [--repo DIR]\n")
		return 2
	}
	repo, rest, ok := repoFlag("editor extensions", args[1:], errOut)
	if !ok || len(rest) > 0 {
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "editor extensions"}
	return done(p, editor.Install(sys.OS{}, p, repo))
}

const wallpaperUsage = `usage: dotctl wallpaper [--repo DIR] search <query...> [--purity 100] [--category 111] [--sorting random]
       dotctl wallpaper [--repo DIR] random [--purity ...] [--category ...] [--sorting ...]
       dotctl wallpaper [--repo DIR] set <image>
`

// runWallpaper is `dotctl wallpaper search|random|set`.
func runWallpaper(home string, args []string, out, errOut io.Writer) int {
	repo, rest, ok := repoFlag("wallpaper", args, errOut)
	if !ok || len(rest) == 0 {
		fmt.Fprint(errOut, wallpaperUsage)
		return 2
	}
	fs := flag.NewFlagSet("wallpaper "+rest[0], flag.ContinueOnError)
	fs.SetOutput(errOut)
	var s wallpaper.Search
	fs.StringVar(&s.Purity, "purity", "", "100 SFW (default), 110, 111")
	fs.StringVar(&s.Category, "category", "", "111 general/anime/people (default)")
	fs.StringVar(&s.Sorting, "sorting", "", "random (default), date_added, relevance, views, favorites, toplist")
	words, err := parseInterspersed(fs, rest[1:])
	if err != nil {
		fmt.Fprint(errOut, wallpaperUsage)
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "wallpaper"}
	e := wallpaper.Env{Home: home, Repo: repo, Sys: sys.OS{}, UI: p}
	switch {
	case rest[0] == "search" && len(words) > 0:
		s.Query = strings.Join(words, " ")
		return done(p, wallpaper.Fetch(e, s))
	case rest[0] == "random" && len(words) == 0:
		return done(p, wallpaper.Fetch(e, s))
	case rest[0] == "set" && len(words) == 1:
		return done(p, wallpaper.Set(e, words[0]))
	default:
		fmt.Fprint(errOut, wallpaperUsage)
		return 2
	}
}

// parseInterspersed parses flags wherever they stand among the words.
func parseInterspersed(fs *flag.FlagSet, args []string) ([]string, error) {
	var words []string
	for {
		if err := fs.Parse(args); err != nil {
			return nil, err
		}
		if fs.NArg() == 0 {
			return words, nil
		}
		words = append(words, fs.Arg(0))
		args = fs.Args()[1:]
	}
}

// runTemplates is `dotctl templates render [--repo DIR]`, run by activation
// before the links are written.
func runTemplates(args []string, out, errOut io.Writer) int {
	if len(args) == 0 || args[0] != "render" {
		fmt.Fprint(errOut, "usage: dotctl templates render [--repo DIR]\n")
		return 2
	}
	repo, rest, ok := repoFlag("templates render", args[1:], errOut)
	if !ok || len(rest) > 0 {
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "templates"}
	_, err := templates.RenderAll(templates.Values{Home: os.Getenv("HOME"), User: os.Getenv("USER"), Root: repo})
	return done(p, err)
}

// runLedger is `dotctl ledger sync once|loop`: this machine's LiteLLM spend
// rows to the observer's cost ledger (the service runs loop).
func runLedger(home string, args []string, out, errOut io.Writer) int {
	if len(args) != 2 || args[0] != "sync" || (args[1] != "once" && args[1] != "loop") {
		fmt.Fprint(errOut, "usage: dotctl ledger sync once|loop\n")
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "ledger sync"}
	host, _ := os.Hostname()
	c, err := ledger.FromEnv(os.Getenv, home, host)
	if err != nil {
		return done(p, err)
	}
	if args[1] == "once" {
		return done(p, ledger.Once(sys.OS{}, p, c))
	}
	interval := 300 * time.Second
	if s := os.Getenv("LEDGER_INTERVAL"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 {
			return done(p, fmt.Errorf("LEDGER_INTERVAL must be a number of seconds, not %q", s))
		}
		interval = time.Duration(n) * time.Second
	}
	ledger.Loop(sys.OS{}, p, c, interval, time.Sleep)
	return 0
}

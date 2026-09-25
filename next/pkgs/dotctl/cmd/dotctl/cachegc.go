package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/cachegc"
)

// cbmIndex is Codebase-Memory's own CLI: the only safe way to delete an index.
type cbmIndex struct{}

func (cbmIndex) List() ([]cachegc.Project, error) {
	out, err := exec.Command("codebase-memory-mcp", "cli", "list_projects", "--include-details", "true", "--limit", "100").Output()
	if err != nil || len(out) == 0 {
		return nil, nil // like the shell script: nothing listed, nothing to do
	}
	return cachegc.ParseProjects(out)
}

func (cbmIndex) Delete(name string) error {
	return exec.Command("codebase-memory-mcp", "cli", "delete_project", "--project", name).Run()
}

// envInt reads a whole-number setting, or the default when unset.
func envInt(name string, def int64) (int64, error) {
	v := os.Getenv(name)
	if v == "" {
		return def, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a whole number, not %q", name, v)
	}
	return n, nil
}

func cacheConfig(home string) (cachegc.Config, error) {
	root := os.Getenv("CBM_CACHE_DIR")
	if root == "" {
		base := os.Getenv("XDG_CACHE_HOME")
		if base == "" {
			base = filepath.Join(home, ".cache")
		}
		root = filepath.Join(base, "codebase-memory-mcp")
	}
	days, err := envInt("CODE_GRAPH_CACHE_TTL_DAYS", 30)
	if err != nil {
		return cachegc.Config{}, err
	}
	gib, err := envInt("CODE_GRAPH_CACHE_MAX_GIB", 5)
	if err != nil {
		return cachegc.Config{}, err
	}
	hours, err := envInt("CODE_GRAPH_CACHE_GC_INTERVAL_HOURS", 24)
	if err != nil {
		return cachegc.Config{}, err
	}
	return cachegc.Config{
		StateDir: filepath.Join(root, "dotfiles-access"),
		TTL:      time.Duration(days) * 24 * time.Hour,
		MaxBytes: gib << 30,
		Interval: time.Duration(hours) * time.Hour,
		Now:      time.Now,
	}, nil
}

// runCacheGC is `dotctl cache-gc`, also reached as `code-graph-cache-gc`
// (the name the harness wrappers and skills call).
func runCacheGC(home string, args []string, idx cachegc.Index, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("cache-gc", flag.ContinueOnError)
	fs.SetOutput(errOut)
	force := fs.Bool("force", false, "run even within the interval")
	dryRun := fs.Bool("dry-run", false, "report what would be removed, remove nothing")
	quiet := fs.Bool("quiet", false, "print nothing")
	touch := fs.String("touch", "", "record that the repository at this path was just used")
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 {
		return 2
	}
	c, err := cacheConfig(home)
	if err != nil {
		fmt.Fprintln(errOut, "cache-gc:", err)
		return 2
	}
	c.Force, c.DryRun = *force, *dryRun
	if *touch != "" {
		if err := cachegc.Touch(c, *touch); err != nil {
			fmt.Fprintln(errOut, "cache-gc:", err)
			return 1
		}
		return 0
	}
	if idx == nil {
		if _, err := exec.LookPath("codebase-memory-mcp"); err != nil {
			return 0
		}
		idx = cbmIndex{}
	}
	res, err := cachegc.Run(c, idx)
	if err != nil {
		fmt.Fprintln(errOut, "cache-gc:", err)
		return 1
	}
	if !*quiet {
		for _, name := range res.Removed {
			fmt.Fprintln(out, "removed", name)
		}
		if res.OverLimit {
			fmt.Fprintln(errOut, "cache-gc: still above the size limit; indexes used in the last day were kept")
		}
	}
	return 0
}

package pstack

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Setup makes the profile usable, and is safe to run again: the checkout is
// fetched only when it is not already at the pinned commit, each fix is
// applied only when its line is still the upstream one, and jig's apply is
// itself idempotent.
func Setup(e Env) error {
	u, err := LoadUpstream(e.Repo)
	if err != nil {
		return err
	}
	for _, tool := range []string{"git", "bash", "bun", "claude"} {
		if !e.Sys.Has(tool) {
			return fmt.Errorf("%s is not on PATH; the pstack profile needs it", tool)
		}
	}
	if err := ensureCheckout(e, u); err != nil {
		return err
	}
	plugin := e.PluginDir(u)
	if _, err := os.Stat(filepath.Join(plugin, ".claude-plugin", "plugin.json")); err != nil {
		return fmt.Errorf("the pinned checkout has no plugin at %s: %w", plugin, err)
	}
	for _, f := range u.Fixes {
		if err := applyFix(plugin, f, e.UI); err != nil {
			return err
		}
	}
	if err := ensureConfigDir(e.ConfigDir()); err != nil {
		return err
	}
	e.UI.Note("jig apply --target claude --write into %s (rules profile %s)", e.ConfigDir(), ProfileName)
	jig := filepath.Join(e.Repo, "harness", "bin", "jig")
	if err := e.Sys.Run(e.ProfileEnv(), "bash", jig, "apply", "--target", "claude", "--write"); err != nil {
		return fmt.Errorf("jig apply for the pstack profile: %w", err)
	}
	e.UI.Success("pstack %s pinned at %s, profile at %s", u.Version, u.Commit[:12], e.ConfigDir())
	e.UI.Steps(
		"dotctl pstack run   (or: claude-pstack) — the first run asks you to log in; the profile has its own login",
		"type /pstack:poteto-mode to start a run; /pstack:poteto-help explains the rest",
		fmt.Sprintf("the evaluation log is %s", filepath.Join(e.ConfigDir(), "evaluation.tsv")),
	)
	return nil
}

// ensureConfigDir creates the profile's configuration directory and keeps it
// 0700 whether it is new or not: it holds the profile's own login.
func ensureConfigDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create the profile's configuration directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("restrict the profile's configuration directory: %w", err)
	}
	return nil
}

// ensureCheckout brings the checkout to the pinned commit with a one-commit
// fetch of exactly that commit: no branch is tracked, so a daily upstream
// rewrite cannot move the evaluation. Every step is repaired on every run —
// a missing remote is added, a remote that no longer matches the pin is
// pointed at it, and the forced checkout discards the fixes a previous run
// wrote (they are reapplied after), so a moved pin never fails on them.
func ensureCheckout(e Env, u Upstream) error {
	dir := e.CheckoutDir()
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create the checkout directory: %w", err)
		}
		e.UI.Note("new checkout of %s at %s", u.Repo, dir)
		if err := e.Sys.Run(nil, "git", "init", "-q", dir); err != nil {
			return fmt.Errorf("git init: %w", err)
		}
	}
	if err := ensureOrigin(e, dir, u.Repo); err != nil {
		return err
	}
	// rev-parse fails on a fresh init (no commit yet) or a broken checkout;
	// either way the checkout is not at the pin, which is what the fetch repairs
	if head, err := e.Sys.Output("git", "-C", dir, "rev-parse", "HEAD"); err == nil && strings.TrimSpace(head) == u.Commit {
		e.UI.Note("checkout already at %s", u.Commit[:12])
		return nil
	}
	e.UI.Note("fetching %s (one commit)", u.Commit[:12])
	if err := e.Sys.Run(nil, "git", "-C", dir, "fetch", "-q", "--depth", "1", "origin", u.Commit); err != nil {
		return fmt.Errorf("git fetch of the pinned commit: %w", err)
	}
	if err := e.Sys.Run(nil, "git", "-C", dir, "checkout", "-q", "-f", "--detach", u.Commit); err != nil {
		return fmt.Errorf("git checkout of the pinned commit: %w", err)
	}
	return nil
}

// ensureOrigin makes `origin` exist and point at the pin's repository.
func ensureOrigin(e Env, dir, repo string) error {
	current, err := e.Sys.Output("git", "-C", dir, "remote", "get-url", "origin")
	if err != nil {
		if err := e.Sys.Run(nil, "git", "-C", dir, "remote", "add", "origin", repo); err != nil {
			return fmt.Errorf("git remote add: %w", err)
		}
		return nil
	}
	if strings.TrimSpace(current) == repo {
		return nil
	}
	e.UI.Note("origin was %s; pointing it at the pin", strings.TrimSpace(current))
	if err := e.Sys.Run(nil, "git", "-C", dir, "remote", "set-url", "origin", repo); err != nil {
		return fmt.Errorf("git remote set-url: %w", err)
	}
	return nil
}

// applyFix replaces one whole line in one file of the plugin, once. The
// upstream line is looked for first, so a file that happens to contain the
// fixed text elsewhere is still fixed; a file with neither line is a changed
// upstream, reported rather than guessed at.
func applyFix(plugin string, f Fix, p interface{ Note(string, ...any) }) error {
	path, err := regularFileUnder(plugin, filepath.Join(plugin, filepath.FromSlash(f.File)))
	if err != nil {
		return fmt.Errorf("fix %s: %w", f.File, err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("fix %s: %w", f.File, err)
	}
	text := string(b)
	from := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(f.From) + `$`)
	to := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(f.To) + `$`)
	switch {
	case from.MatchString(text):
		fixed := strings.Replace(text, from.FindString(text), f.To, 1)
		if err := os.WriteFile(path, []byte(fixed), 0o644); err != nil {
			return fmt.Errorf("fix %s: %w", f.File, err)
		}
		p.Note("fixed %s: %q → %q (%s)", f.File, f.From, f.To, f.Why)
		return nil
	case to.MatchString(text):
		return nil
	default:
		return errors.New("fix " + f.File + ": neither the upstream line nor the fixed one is there; upstream changed, move the pin deliberately")
	}
}

// regularFileUnder resolves path through any symlinks and returns it only
// when it is a regular file inside root (also resolved). The `..` check on
// the pin is lexical; a symlink planted in the fetched tree is not, and a
// write through one would land outside the checkout.
func regularFileUnder(root, path string) (string, error) {
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	if real != realRoot && !strings.HasPrefix(real, realRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("%s resolves outside the plugin directory (%s)", path, real)
	}
	info, err := os.Lstat(real)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", real)
	}
	return real, nil
}

package pstack

import (
	"bufio"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Run starts Claude Code in the profile with the pinned plugin loaded for
// this session only (`--plugin-dir <path>` takes exactly one path, so the
// user's own arguments after it are never read as plugin directories;
// nothing is installed), passing the rest of the arguments through. The
// environment carries the configuration directory so Claude Code, and the
// jig hooks it spawns, see the profile.
func Run(e Env, args []string) error {
	u, err := LoadUpstream(e.Repo)
	if err != nil {
		return err
	}
	plugin := e.PluginDir(u)
	if _, err := os.Stat(filepath.Join(plugin, ".claude-plugin", "plugin.json")); err != nil {
		return errors.New("the pstack plugin is not set up; run: dotctl pstack setup")
	}
	if _, err := os.Stat(filepath.Join(e.ConfigDir(), "settings.json")); err != nil {
		return errors.New("the pstack profile has no settings.json; run: dotctl pstack setup")
	}
	argv := append([]string{"--plugin-dir", plugin}, args...)
	return e.Sys.Run(e.ProfileEnv(), "claude", argv...)
}

// Status prints the pin, the checkout's state, and the evaluation log's size.
func Status(e Env) error {
	u, err := LoadUpstream(e.Repo)
	if err != nil {
		return err
	}
	e.UI.Heading("pstack evaluation profile")
	e.UI.Note("pin:      %s @ %s (%s)", u.Repo, u.Commit[:12], u.Version)
	head, herr := e.Sys.Output("git", "-C", e.CheckoutDir(), "rev-parse", "HEAD")
	switch {
	case herr != nil:
		e.UI.Warn("checkout: none at %s (run: dotctl pstack setup)", e.CheckoutDir())
	case strings.TrimSpace(head) == u.Commit:
		e.UI.Note("checkout: at the pin, %s", e.CheckoutDir())
	default:
		e.UI.Warn("checkout: at %s, not the pin (run: dotctl pstack setup)", strings.TrimSpace(head)[:12])
	}
	if _, err := os.Stat(filepath.Join(e.ConfigDir(), "settings.json")); err != nil {
		e.UI.Warn("profile:  %s is not generated yet (run: dotctl pstack setup)", e.ConfigDir())
	} else {
		e.UI.Note("profile:  %s", e.ConfigDir())
	}
	n, err := countLines(filepath.Join(e.ConfigDir(), "evaluation.tsv"))
	if err != nil {
		e.UI.Note("log:      no evaluation.tsv yet")
	} else {
		e.UI.Note("log:      %d run(s) recorded in evaluation.tsv", n)
	}
	return nil
}

func countLines(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	n := 0
	s := bufio.NewScanner(f)
	for s.Scan() {
		if strings.TrimSpace(s.Text()) != "" {
			n++
		}
	}
	return n, s.Err()
}

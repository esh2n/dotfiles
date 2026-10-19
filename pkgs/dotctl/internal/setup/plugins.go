package setup

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// External skill packs (harness/plugins/<name>/source.json) are fetched
// into <plugins dir>/<name>, where jig apply links their skills and agents
// beside the house's own (rules/decisions/2026-10-18-pstack-shared-skills.md).
// Each run follows the pack's branch, or stays at its pinned commit, and
// names the skills that changed. A failed fetch keeps the previous version,
// so the harnesses go on with what they had.

var (
	pluginNameRe   = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	pluginRepoRe   = regexp.MustCompile(`^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	pluginRefRe    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]*$`)
	pluginCommitRe = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

const pluginFetchTimeout = 3 * time.Minute

// pluginSource is the part of source.json the fetch needs; jig reads the rest.
type pluginSource struct {
	name   string
	Repo   string `json:"repo"`
	Ref    string `json:"ref"`
	Commit string `json:"commit"`
	Skills string `json:"skills"`
	Agents string `json:"agents"`
}

// pluginsDir is where packs are checked out, resolved the way jig's
// resolvePluginsDir does so the two agree without passing a path.
func pluginsDir(home string, getenv func(string) string) string {
	if d := getenv("JIG_PLUGINS_DIR"); d != "" {
		return d
	}
	if d := getenv("XDG_DATA_HOME"); d != "" {
		return filepath.Join(d, "jig", "plugins")
	}
	return filepath.Join(home, ".local", "share", "jig", "plugins")
}

// pluginsLog is jig's state directory's record of what each fetch landed on.
func (e Env) pluginsLog() string {
	if d := e.Getenv("JIG_STATE_DIR"); d != "" {
		return filepath.Join(d, "plugins.jsonl")
	}
	return e.path(".local", "state", "jig", "plugins.jsonl")
}

// Plugins is the `plugins` step: fetch every pack harness/plugins/ names.
func Plugins(e Env) error {
	if !e.need("git") {
		return nil
	}
	sources, err := loadPluginSources(e.Repo)
	if err != nil {
		return err
	}
	// one pack's failure does not stop the next; each is named in the error
	var errs []error
	for _, s := range sources {
		if err := fetchPlugin(e, s); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", s.name, err))
		}
	}
	return errors.Join(errs...)
}

func loadPluginSources(repo string) ([]pluginSource, error) {
	root := filepath.Join(repo, "harness", "plugins")
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []pluginSource
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(root, entry.Name(), "source.json"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		s, err := parsePluginSource(entry.Name(), b)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

func parsePluginSource(name string, b []byte) (pluginSource, error) {
	s := pluginSource{name: name}
	if !pluginNameRe.MatchString(name) {
		return s, fmt.Errorf("plugin name %q is not lowercase letters, digits and hyphens", name)
	}
	if err := json.Unmarshal(b, &s); err != nil {
		return s, fmt.Errorf("plugin %q: source.json: %w", name, err)
	}
	switch {
	case !pluginRepoRe.MatchString(s.Repo):
		return s, fmt.Errorf("plugin %q: repo must be a GitHub repository, https://github.com/<owner>/<repo>", name)
	case !pluginRefRe.MatchString(s.Ref) || strings.Contains(s.Ref, ".."):
		return s, fmt.Errorf("plugin %q: ref must be a branch name", name)
	case s.Commit != "" && !pluginCommitRe.MatchString(s.Commit):
		return s, fmt.Errorf("plugin %q: commit must be a 40 hex commit id", name)
	case !insideCheckout(s.Skills):
		return s, fmt.Errorf("plugin %q: skills must be a path inside the checkout", name)
	case s.Agents != "" && !insideCheckout(s.Agents):
		return s, fmt.Errorf("plugin %q: agents must be a path inside the checkout", name)
	}
	return s, nil
}

// insideCheckout is jig's rule too: relative, and no empty, "." or ".." segment.
func insideCheckout(p string) bool {
	if p == "" || strings.HasPrefix(p, "/") {
		return false
	}
	for _, part := range strings.Split(p, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

// symlinkIn names a symlink the commit has on the way to, or inside, one of
// dirs, or "" when it has none. A pack's skills and agents are linked into
// every harness, so a symlink there could expose any path on the machine.
func (e Env) symlinkIn(dir, commit string, dirs ...string) (string, error) {
	out, _, err := e.Sys.Capture(time.Minute, "git", "-C", dir, "ls-tree", "-r", "--full-tree", commit)
	if err != nil {
		return "", fmt.Errorf("list the fetched tree: %w", err)
	}
	for _, line := range strings.Split(out, "\n") {
		meta, path, ok := strings.Cut(line, "\t")
		if !ok || !strings.HasPrefix(meta, "120000 ") {
			continue
		}
		for _, d := range dirs {
			if d != "" && (d == path || strings.HasPrefix(d, path+"/") || strings.HasPrefix(path, d+"/")) {
				return path, nil
			}
		}
	}
	return "", nil
}

func fetchPlugin(e Env, s pluginSource) error {
	dir := filepath.Join(pluginsDir(e.Home, e.Getenv), s.name)
	if !exists(filepath.Join(dir, ".git")) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := e.quiet(time.Minute, "git", "init", "-q", dir); err != nil {
			return err
		}
	}
	if err := ensurePluginOrigin(e, dir, s.Repo); err != nil {
		return err
	}
	old := e.gitRev(dir, "HEAD")
	target, follows := s.Ref, "follows "+s.Ref
	if s.Commit != "" {
		target, follows = s.Commit, "pinned at "+s.Commit[:12]
	}
	if err := e.quiet(pluginFetchTimeout, "git", "-C", dir, "fetch", "-q", "--depth", "1", "origin", target); err != nil {
		if old == "" {
			return fmt.Errorf("fetch failed and there is no previous version: %w", err)
		}
		return fmt.Errorf("fetch failed; kept %s: %w", old[:12], err)
	}
	fetched := e.gitRev(dir, "FETCH_HEAD")
	if fetched == "" {
		return errors.New("fetch reported no commit")
	}
	link, err := e.symlinkIn(dir, fetched, s.Skills, s.Agents)
	if err != nil {
		return err
	}
	if link != "" {
		kept := "nothing checked out"
		if old != "" {
			kept = "kept " + old[:12]
		}
		return fmt.Errorf("%s has a symlink at %s; refused it, %s", fetched[:12], link, kept)
	}
	// Checked out and cleaned every time, so the tree is exactly the commit:
	// a damaged checkout heals, and a file upstream deleted does not linger.
	// Ignored files (an installed node_modules) stay.
	if err := e.quiet(time.Minute, "git", "-C", dir, "checkout", "-q", "-f", "--detach", "FETCH_HEAD"); err != nil {
		return err
	}
	if err := e.quiet(time.Minute, "git", "-C", dir, "clean", "-q", "-f", "-d"); err != nil {
		return err
	}
	switch {
	case fetched == old:
		e.UI.Note("%s: up to date at %s (%s)", s.name, fetched[:12], follows)
		return nil
	case old == "":
		e.UI.Success("%s: fetched %s (%s) into %s", s.name, fetched[:12], follows, dir)
	default:
		e.UI.Success("%s: %s → %s (%s)", s.name, old[:12], fetched[:12], follows)
		e.reportSkillChanges(dir, old, fetched, s.Skills)
	}
	// the record only helps find a bad version later; the fetch itself succeeded
	if err := e.logPluginFetch(s.name, fetched, old); err != nil {
		e.UI.Warn("%s: could not record the fetch: %v", s.name, err)
	}
	return nil
}

func ensurePluginOrigin(e Env, dir, repo string) error {
	current, _, err := e.Sys.Capture(time.Minute, "git", "-C", dir, "remote", "get-url", "origin")
	if err != nil {
		return e.quiet(time.Minute, "git", "-C", dir, "remote", "add", "origin", repo)
	}
	if strings.TrimSpace(current) == repo {
		return nil
	}
	return e.quiet(time.Minute, "git", "-C", dir, "remote", "set-url", "origin", repo)
}

// gitRev is the commit a ref names, or "" when it names none.
func (e Env) gitRev(dir, ref string) string {
	out, _, err := e.Sys.Capture(time.Minute, "git", "-C", dir, "rev-parse", ref)
	if err != nil {
		return ""
	}
	rev := strings.TrimSpace(out)
	if !pluginCommitRe.MatchString(rev) {
		return ""
	}
	return rev
}

// reportSkillChanges names the skill directories added, removed and changed
// between two commits. Best effort: a diff that fails says nothing more.
func (e Env) reportSkillChanges(dir, from, to, skills string) {
	out, _, err := e.Sys.Capture(time.Minute, "git", "-C", dir, "diff", "--name-status", from, to, "--", skills)
	if err != nil {
		return
	}
	prefix := strings.TrimSuffix(skills, "/") + "/"
	status := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 2 || !strings.HasPrefix(fields[len(fields)-1], prefix) {
			continue
		}
		rest := strings.TrimPrefix(fields[len(fields)-1], prefix)
		skill, file, _ := strings.Cut(rest, "/")
		if file == "SKILL.md" && (fields[0] == "A" || fields[0] == "D") {
			status[skill] = fields[0]
		} else if _, seen := status[skill]; !seen {
			status[skill] = "M"
		}
	}
	for _, kind := range []struct{ code, word string }{{"A", "added"}, {"D", "removed"}, {"M", "changed"}} {
		var names []string
		for skill, code := range status {
			if code == kind.code {
				names = append(names, skill)
			}
		}
		if len(names) > 0 {
			sort.Strings(names)
			e.UI.Note("  %s: %s", kind.word, strings.Join(names, ", "))
		}
	}
}

func (e Env) logPluginFetch(name, commit, previous string) error {
	path := e.pluginsLog()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	line, err := json.Marshal(map[string]string{
		"at": e.Now().UTC().Format(time.RFC3339), "name": name, "commit": commit, "previous": previous,
	})
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

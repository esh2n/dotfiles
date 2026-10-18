package setup

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	oldCommit = "1111111111111111111111111111111111111111"
	newCommit = "2222222222222222222222222222222222222222"
)

const pstackSource = `{
  "repo": "https://github.com/cursor/plugins",
  "ref": "main",
  "skills": "pstack/skills",
  "translated": []
}`

// seedPlugin writes one pack's source.json into the checkout and returns
// where the step will fetch it.
func seedPlugin(t *testing.T, repo, home, source string) string {
	t.Helper()
	write(t, filepath.Join(repo, "harness", "plugins", "pstack", "source.json"), source)
	write(t, filepath.Join(repo, "harness", "plugins", "README.md"), "# plugins\n")
	return filepath.Join(home, ".local", "share", "jig", "plugins", "pstack")
}

func gitLine(dir string, args ...string) string {
	return "git -C " + dir + " " + strings.Join(args, " ")
}

func TestPluginsFirstFetchClonesTheBranch(t *testing.T) {
	w := newWorld(t, "git")
	dir := seedPlugin(t, w.repo, w.home, pstackSource)
	w.sys.fail["git -C "+dir+" remote get-url origin"] = errors.New("no such remote")
	w.sys.fail[gitLine(dir, "rev-parse", "HEAD")] = errors.New("no commit yet")
	w.sys.outputs[gitLine(dir, "rev-parse", "FETCH_HEAD")] = newCommit + "\n"

	if err := Run(w.env, "plugins"); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"git init -q " + dir,
		gitLine(dir, "remote", "add", "origin", "https://github.com/cursor/plugins"),
		gitLine(dir, "fetch", "-q", "--depth", "1", "origin", "main"),
		gitLine(dir, "checkout", "-q", "-f", "--detach", "FETCH_HEAD"),
	} {
		if !w.sys.ran(want) {
			t.Errorf("did not run %q; ran %v", want, w.sys.calls)
		}
	}
	if !strings.Contains(w.out.String(), "pstack: fetched 222222222222") {
		t.Fatalf("out %q", w.out.String())
	}
	log, err := os.ReadFile(filepath.Join(w.home, ".local", "state", "jig", "plugins.jsonl"))
	if err != nil || !strings.Contains(string(log), `"commit":"`+newCommit+`"`) {
		t.Fatalf("log %q, %v", log, err)
	}
}

func TestPluginsUpdateNamesTheSkillsThatChanged(t *testing.T) {
	w := newWorld(t, "git")
	dir := seedPlugin(t, w.repo, w.home, pstackSource)
	write(t, filepath.Join(dir, ".git", "HEAD"), "x")
	w.sys.outputs[gitLine(dir, "remote", "get-url", "origin")] = "https://github.com/cursor/plugins\n"
	w.sys.outputs[gitLine(dir, "rev-parse", "HEAD")] = oldCommit + "\n"
	w.sys.outputs[gitLine(dir, "rev-parse", "FETCH_HEAD")] = newCommit + "\n"
	w.sys.outputs[gitLine(dir, "diff", "--name-status")] = strings.Join([]string{
		"A\tpstack/skills/new-one/SKILL.md",
		"D\tpstack/skills/old-one/SKILL.md",
		"M\tpstack/skills/arena/SKILL.md",
		"M\tpstack/skills/arena/notes.md",
	}, "\n")

	if err := Run(w.env, "plugins"); err != nil {
		t.Fatal(err)
	}
	if w.sys.ran("git init -q " + dir) {
		t.Fatal("re-initialized an existing checkout")
	}
	out := w.out.String()
	for _, want := range []string{"111111111111 → 222222222222", "added: new-one", "removed: old-one", "changed: arena"} {
		if !strings.Contains(out, want) {
			t.Errorf("out lacks %q: %q", want, out)
		}
	}
}

func TestPluginsRefusesACommitWithASymlinkInTheSkills(t *testing.T) {
	w := newWorld(t, "git")
	dir := seedPlugin(t, w.repo, w.home, pstackSource)
	write(t, filepath.Join(dir, ".git", "HEAD"), "x")
	w.sys.outputs[gitLine(dir, "remote", "get-url", "origin")] = "https://github.com/cursor/plugins\n"
	w.sys.outputs[gitLine(dir, "rev-parse", "HEAD")] = oldCommit + "\n"
	w.sys.outputs[gitLine(dir, "rev-parse", "FETCH_HEAD")] = newCommit + "\n"
	for _, link := range []string{"pstack/skills/evil", "pstack"} {
		w.sys.outputs[gitLine(dir, "ls-tree")] = "100644 blob aaa\tREADME.md\n120000 blob bbb\t" + link + "\n"
		err := Run(w.env, "plugins")
		if err == nil || !strings.Contains(err.Error(), "symlink at "+link) || !strings.Contains(err.Error(), "kept 111111111111") {
			t.Fatalf("%s: err %v", link, err)
		}
		if w.sys.ran(gitLine(dir, "checkout", "-q", "-f", "--detach", "FETCH_HEAD")) {
			t.Fatalf("%s: checked out a refused commit", link)
		}
	}
	w.sys.outputs[gitLine(dir, "ls-tree")] = "120000 blob ccc\tother/link\n"
	if err := Run(w.env, "plugins"); err != nil {
		t.Fatalf("a symlink elsewhere in the repository is not the pack's business: %v", err)
	}
}

func TestPluginsAlreadyCurrentDoesNothingMore(t *testing.T) {
	w := newWorld(t, "git")
	dir := seedPlugin(t, w.repo, w.home, pstackSource)
	write(t, filepath.Join(dir, ".git", "HEAD"), "x")
	w.sys.outputs[gitLine(dir, "remote", "get-url", "origin")] = "https://github.com/cursor/plugins\n"
	w.sys.outputs[gitLine(dir, "rev-parse", "HEAD")] = newCommit + "\n"
	w.sys.outputs[gitLine(dir, "rev-parse", "FETCH_HEAD")] = newCommit + "\n"

	if err := Run(w.env, "plugins"); err != nil {
		t.Fatal(err)
	}
	// the tree is restored even when nothing is new, so a damaged checkout heals
	for _, want := range []string{
		gitLine(dir, "checkout", "-q", "-f", "--detach", "FETCH_HEAD"),
		gitLine(dir, "clean", "-q", "-f", "-d"),
	} {
		if !w.sys.ran(want) {
			t.Errorf("did not run %q", want)
		}
	}
	if _, err := os.Stat(filepath.Join(w.home, ".local", "state", "jig", "plugins.jsonl")); err == nil {
		t.Fatal("recorded a fetch that changed nothing")
	}
	if !strings.Contains(w.out.String(), "pstack: up to date at 222222222222") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestPluginsPinnedCommitFetchesThatCommit(t *testing.T) {
	pinned := strings.Replace(pstackSource, `"ref": "main",`, `"ref": "main", "commit": "`+oldCommit+`",`, 1)
	w := newWorld(t, "git")
	dir := seedPlugin(t, w.repo, w.home, pinned)
	w.sys.fail[gitLine(dir, "rev-parse", "HEAD")] = errors.New("no commit yet")
	w.sys.outputs[gitLine(dir, "rev-parse", "FETCH_HEAD")] = oldCommit + "\n"
	if err := Run(w.env, "plugins"); err != nil {
		t.Fatal(err)
	}
	if !w.sys.ran(gitLine(dir, "fetch", "-q", "--depth", "1", "origin", oldCommit)) {
		t.Fatalf("calls %v", w.sys.calls)
	}
	if !strings.Contains(w.out.String(), "pinned") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestPluginsFailedFetchKeepsThePreviousVersion(t *testing.T) {
	w := newWorld(t, "git")
	dir := seedPlugin(t, w.repo, w.home, pstackSource)
	write(t, filepath.Join(dir, ".git", "HEAD"), "x")
	w.sys.outputs[gitLine(dir, "remote", "get-url", "origin")] = "https://github.com/cursor/plugins\n"
	w.sys.outputs[gitLine(dir, "rev-parse", "HEAD")] = oldCommit + "\n"
	w.sys.fail[gitLine(dir, "fetch")] = errors.New("could not resolve host")

	err := Run(w.env, "plugins")
	if err == nil || !strings.Contains(err.Error(), "kept 111111111111") {
		t.Fatalf("err %v", err)
	}
	if w.sys.ran(gitLine(dir, "checkout", "-q", "-f", "--detach", "FETCH_HEAD")) {
		t.Fatal("checked out after a failed fetch")
	}
}

func TestPluginsRefusesASourceThatLeavesGitHubOrTheCheckout(t *testing.T) {
	for _, body := range []string{
		strings.Replace(pstackSource, "https://github.com/cursor/plugins", "https://evil.example/a/b", 1),
		strings.Replace(pstackSource, `"ref": "main"`, `"ref": "--upload-pack=x"`, 1),
		`{"repo": "https://github.com/a/b", "ref": "main", "commit": "nope", "skills": "s"}`,
		strings.Replace(pstackSource, `"ref": "main"`, `"ref": "main..x"`, 1),
		strings.Replace(pstackSource, `"pstack/skills"`, `"pstack//skills"`, 1),
		strings.Replace(pstackSource, `"pstack/skills"`, `"./skills"`, 1),
	} {
		w := newWorld(t, "git")
		seedPlugin(t, w.repo, w.home, body)
		if err := Run(w.env, "plugins"); err == nil {
			t.Errorf("accepted %s", body)
		}
		for _, c := range w.sys.calls {
			if strings.Contains(c, "fetch") {
				t.Errorf("fetched for %s", body)
			}
		}
	}
}

func TestPluginsWithoutGitOrPacksSkips(t *testing.T) {
	w := newWorld(t)
	if err := Run(w.env, "plugins"); err != nil || len(w.sys.calls) != 0 {
		t.Fatalf("err %v, calls %v", err, w.sys.calls)
	}
	w = newWorld(t, "git")
	if err := Run(w.env, "plugins"); err != nil || len(w.sys.calls) != 0 {
		t.Fatalf("no packs: err %v, calls %v", err, w.sys.calls)
	}
}

func TestPluginsDirFollowsTheSameRulesAsJig(t *testing.T) {
	get := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	if got := pluginsDir("/h", get(nil)); got != "/h/.local/share/jig/plugins" {
		t.Fatal(got)
	}
	if got := pluginsDir("/h", get(map[string]string{"XDG_DATA_HOME": "/d"})); got != "/d/jig/plugins" {
		t.Fatal(got)
	}
	if got := pluginsDir("/h", get(map[string]string{"JIG_PLUGINS_DIR": "/p", "XDG_DATA_HOME": "/d"})); got != "/p" {
		t.Fatal(got)
	}
}

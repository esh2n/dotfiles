package templates

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestRenderAllFillsPlaceholdersAndIncludes(t *testing.T) {
	root := t.TempDir()
	v := Values{Home: "/home/tester", User: "tester", Root: root}
	write(t, filepath.Join(root, "a", "conf.toml.template"), "home={{HOME}} user={{USER}} root={{DOTFILES_ROOT}}\n")
	write(t, filepath.Join(root, "g", ".gitconfig.template"), "[user]\n{{CONDITIONAL_INCLUDES}}\n[core]\n")
	write(t, filepath.Join(root, "node_modules", "x", "y.template"), "{{HOME}}")
	cond := conditionalDir(root)
	write(t, filepath.Join(cond, "work.conf"), "# GITDIR: {{HOME}}/work/\n[user]\n")
	write(t, filepath.Join(cond, "default.conf"), "[user]\n")
	write(t, filepath.Join(cond, "notes.txt"), "")
	n, err := RenderAll(v)
	if err != nil || n != 2 {
		t.Fatalf("n %d err %v", n, err)
	}
	if got := read(t, filepath.Join(root, "a", "conf.toml")); got != "home=/home/tester user=tester root="+root+"\n" {
		t.Fatalf("got %q", got)
	}
	want := "[user]\n[include]\n    path = ~/.config/git/conditional/default.conf\n[includeIf \"gitdir:/home/tester/work/\"]\n    path = ~/.config/git/conditional/work.conf\n\n[core]\n"
	if got := read(t, filepath.Join(root, "g", ".gitconfig")); got != want {
		t.Fatalf("got %q", got)
	}
	if _, err := os.Stat(filepath.Join(root, "node_modules", "x", "y")); !os.IsNotExist(err) {
		t.Fatal("rendered under node_modules")
	}
	if n2, _ := RenderAll(v); n2 != 2 || read(t, filepath.Join(root, "a", "conf.toml")) != "home=/home/tester user=tester root="+root+"\n" {
		t.Fatal("a second run differs")
	}
}

func TestIncludesWithoutTheDirectoryAndMissingCheckout(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "x.template"), "[a]\n{{CONDITIONAL_INCLUDES}}\n[b]\n")
	if _, err := RenderAll(Values{Root: root}); err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(root, "x")); got != "[a]\n[b]\n" {
		t.Fatalf("got %q", got)
	}
	if _, err := RenderAll(Values{Root: filepath.Join(root, "nowhere")}); err == nil {
		t.Fatal("a missing checkout is not an error")
	}
}

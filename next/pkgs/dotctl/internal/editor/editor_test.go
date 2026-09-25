package editor

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/ui"
)

type fakeSys struct {
	have  map[string]bool
	calls []string
}

func (f *fakeSys) Exec(c sys.Cmd) (string, string, error) {
	line := c.Name + " " + strings.Join(c.Args, " ")
	f.calls = append(f.calls, line)
	switch {
	case strings.HasSuffix(line, "--list-extensions"):
		return "a.one\nb.two\nc.three\n", "", nil
	case strings.HasSuffix(line, "bad.ext"):
		return "", "", errors.New("exit status 1")
	}
	return "", "", nil
}

func (f *fakeSys) Has(n string) bool { return f.have[n] }

func TestListSkipsCommentsAndBlanks(t *testing.T) {
	got := List("# header\n\na.one  # trailing\n  b.two\n")
	if !reflect.DeepEqual(got, []string{"a.one", "b.two"}) {
		t.Fatalf("got %v", got)
	}
}

func TestInstallIntoEachPresentEditor(t *testing.T) {
	repo := t.TempDir()
	file := filepath.Join(repo, "next", "home", "darwin", "vscode", "config", "extensions.txt")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("a.one\nbad.ext\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := &fakeSys{have: map[string]bool{"code": true}}
	var out, errOut bytes.Buffer
	if err := Install(f, ui.Printer{Out: &out, Err: &errOut}, repo); err != nil {
		t.Fatal(err)
	}
	if f.calls[0] != "code --install-extension a.one" || len(f.calls) != 3 {
		t.Fatalf("calls %v", f.calls)
	}
	if !strings.Contains(out.String(), "VS Code: 1 installed, 1 failed; 3 extensions in all") {
		t.Fatalf("out %q", out.String())
	}
	if !strings.Contains(errOut.String(), "bad.ext failed") || !strings.Contains(errOut.String(), "Cursor is not installed") {
		t.Fatalf("stderr %q", errOut.String())
	}
	if err := Install(f, ui.Printer{}, t.TempDir()); err == nil {
		t.Fatal("a missing list is not an error")
	}
}

package editor

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
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
	file := filepath.Join(repo, "home", "darwin", "vscode", "config", "extensions.txt")
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
	if !strings.Contains(out.String(), "bad.ext failed") || !strings.Contains(out.String(), "Cursor is not installed") {
		t.Fatalf("out %q", out.String())
	}
	if err := Install(f, ui.Printer{}, t.TempDir()); err == nil {
		t.Fatal("a missing list is not an error")
	}
}

func TestPlatformNamesFollowVSCodeTargets(t *testing.T) {
	cases := map[[2]string]string{
		{"darwin", "arm64"}:  "darwin-arm64",
		{"darwin", "amd64"}:  "darwin-x64",
		{"linux", "amd64"}:   "linux-x64",
		{"windows", "amd64"}: "win32-x64",
		{"plan9", "amd64"}:   "",
	}
	for in, want := range cases {
		if got := Platform(in[0], in[1]); got != want {
			t.Errorf("Platform(%s, %s) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

func TestReleaseURLsAreDownloadedOnceAndInstalledFromTheFile(t *testing.T) {
	repo := t.TempDir()
	file := filepath.Join(repo, "home", "darwin", "vscode", "config", "extensions.txt")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	list := "a.one\nhttps://example.test/releases/latest/download/x-{platform}.vsix\n"
	if err := os.WriteFile(file, []byte(list), 0o644); err != nil {
		t.Fatal(err)
	}
	f := &fakeSys{have: map[string]bool{"code": true, "cursor": true}}
	if err := Install(f, ui.Printer{Out: &bytes.Buffer{}, Err: &bytes.Buffer{}}, repo); err != nil {
		t.Fatal(err)
	}
	platform := Platform(runtime.GOOS, runtime.GOARCH)
	var downloads, vsix int
	for _, c := range f.calls {
		if strings.HasPrefix(c, "curl ") {
			downloads++
			if !strings.HasSuffix(c, "x-"+platform+".vsix") {
				t.Fatalf("download %q", c)
			}
		}
		if strings.Contains(c, "--install-extension") && strings.HasSuffix(c, "-x-"+platform+".vsix") {
			vsix++
		}
	}
	if downloads != 1 || vsix != 2 {
		t.Fatalf("downloads %d, installs %d: %v", downloads, vsix, f.calls)
	}
}

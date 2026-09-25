package wallpaper

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/ui"
)

type fakeSys struct {
	os      string
	scripts []string
}

func (f *fakeSys) Exec(c sys.Cmd) (string, string, error) {
	f.scripts = append(f.scripts, strings.Join(c.Args, " "))
	return "", "", nil
}
func (f *fakeSys) OS() string { return f.os }

// web answers in process: the search with body, any image path with bytes.
type web struct {
	search string
	asked  []string
}

func (w *web) RoundTrip(r *http.Request) (*http.Response, error) {
	w.asked = append(w.asked, r.URL.String())
	body := "IMG"
	if strings.Contains(r.URL.Path, "/search") {
		body = w.search
	}
	return &http.Response{StatusCode: 200, Status: "200 OK", Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}, Request: r}, nil
}

func env(t *testing.T, w *web, f *fakeSys) (Env, *bytes.Buffer) {
	t.Helper()
	var out bytes.Buffer
	return Env{Home: t.TempDir(), Repo: t.TempDir(), Sys: f, UI: ui.Printer{Out: &out, Err: &out}, HTTP: &http.Client{Transport: w}, API: "https://wallhaven.cc/api/v1/search"}, &out
}

func TestFetchDownloadsOnceAndSets(t *testing.T) {
	w := &web{search: `{"data": [{"id": "abc123", "path": "https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg"}]}`}
	f := &fakeSys{os: "darwin"}
	e, _ := env(t, w, f)
	if err := Fetch(e, Search{Query: "cyber punk"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(w.asked[0], "q=cyber+punk") || !strings.Contains(w.asked[0], "purity=100") || !strings.Contains(w.asked[0], "sorting=random") {
		t.Fatalf("search %s", w.asked[0])
	}
	file := filepath.Join(e.Repo, "domains", "workspace", "assets", "background", "wallhaven-abc123.jpg")
	if b, _ := os.ReadFile(file); string(b) != "IMG" {
		t.Fatalf("image %q", b)
	}
	if target, _ := os.Readlink(filepath.Join(e.Home, ".current_wallpaper")); target != file {
		t.Fatalf("link %q", target)
	}
	if !strings.Contains(f.scripts[0], `set picture to "`+file+`"`) {
		t.Fatalf("script %q", f.scripts[0])
	}
	w.asked = nil
	if err := Fetch(e, Search{}); err != nil || len(w.asked) != 1 {
		t.Fatalf("downloaded again: %v %v", err, w.asked)
	}
}

func TestFetchRefusesWhatItShouldNotTrust(t *testing.T) {
	for _, search := range []string{
		`{"data": []}`,
		`{"data": [{"id": "x", "path": "https://evil.example/x.jpg"}]}`,
		`{"data": [{"id": "x", "path": "https://evilwallhaven.cc/x.jpg"}]}`,
		`{"data": [{"id": "x", "path": "http://w.wallhaven.cc/x.jpg"}]}`,
		`{"data": [{"id": "../x", "path": "https://w.wallhaven.cc/x.jpg"}]}`,
		`{"data": [{"id": "x", "path": "https://w.wallhaven.cc/x.sh"}]}`,
		`not json`,
	} {
		e, _ := env(t, &web{search: search}, &fakeSys{os: "darwin"})
		if err := Fetch(e, Search{}); err == nil {
			t.Fatalf("%s accepted", search)
		}
	}
	e, _ := env(t, &web{}, &fakeSys{os: "darwin"})
	for _, s := range []Search{{Purity: "1;x"}, {Category: "12"}, {Sorting: "evil"}} {
		if err := Fetch(e, s); err == nil {
			t.Fatalf("%+v accepted", s)
		}
	}
}

func TestSetQuotesThePathAndIsMacOnly(t *testing.T) {
	f := &fakeSys{os: "darwin"}
	e, _ := env(t, &web{}, f)
	file := filepath.Join(e.Repo, `a "b" \c.png`)
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Set(e, file); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f.scripts[0], `a \"b\" \\c.png"`) {
		t.Fatalf("script %q", f.scripts[0])
	}
	if err := Set(e, filepath.Join(e.Repo, "missing.png")); err == nil {
		t.Fatal("a missing image is set")
	}
	e.Sys = &fakeSys{os: "linux"}
	if err := Set(e, file); err == nil {
		t.Fatal("set on linux")
	}
}

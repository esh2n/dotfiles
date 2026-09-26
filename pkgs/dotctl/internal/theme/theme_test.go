package theme

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

type fixture struct {
	home, repo string
	ran        [][]string
}

// newFixture: a checkout with two themes' files and home-manager's palettes
// (~/.config/theme/palettes/<name>/<file> -> the checkout's theme file).
func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{home: t.TempDir(), repo: t.TempDir()}
	for _, name := range []string{"nord", "dracula"} {
		pal := filepath.Join(f.home, ".config", "theme", "palettes", name)
		must(t, os.MkdirAll(pal, 0o755))
		for _, a := range Apps {
			src := filepath.Join(f.repo, a.Source(name))
			must(t, os.MkdirAll(filepath.Dir(src), 0o755))
			must(t, os.WriteFile(src, []byte(name+" "+a.File), 0o644))
			must(t, os.Symlink(src, filepath.Join(pal, a.File)))
		}
	}
	return f
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) env() Env {
	return Env{Home: f.home, Repo: f.repo, Run: func(cmd ...string) error {
		f.ran = append(f.ran, cmd)
		return nil
	}, Has: func(c string) bool { return c != "omarchy" }}
}

// through reads a pointer the way the app does: following every link.
func through(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return string(b)
}

func TestInitPointsEveryAppThroughCurrent(t *testing.T) {
	f := newFixture(t)
	e := f.env()
	must(t, Init(e, "nord"))
	for _, a := range Apps {
		p := filepath.Join(f.repo, a.Pointer)
		target, err := os.Readlink(p)
		if err != nil {
			t.Fatalf("%s is not a link: %v", a.Pointer, err)
		}
		if want := filepath.Join(f.home, ".config", "theme", "current", a.File); target != want {
			t.Fatalf("%s -> %s, want %s", a.Pointer, target, want)
		}
		if got := through(t, p); got != "nord "+a.File {
			t.Fatalf("%s reads %q", a.Pointer, got)
		}
	}
	if got, _ := Current(e); got != "nord" {
		t.Fatalf("Current = %q", got)
	}
}

func TestInitKeepsTheThemeAlreadyChosen(t *testing.T) {
	f := newFixture(t)
	e := f.env()
	must(t, Init(e, "nord"))
	must(t, Set(e, "dracula"))
	must(t, Init(e, "nord"))
	if got, _ := Current(e); got != "dracula" {
		t.Fatalf("Init overrode the chosen theme: %q", got)
	}
}

func TestInitAdoptsTheOldColorsLink(t *testing.T) {
	f := newFixture(t)
	e := f.env()
	old := filepath.Join(f.repo, Apps[0].Pointer)
	must(t, os.MkdirAll(filepath.Dir(old), 0o755))
	must(t, os.Symlink(filepath.Join(f.repo, Apps[0].Source("dracula")), old))
	must(t, Init(e, "nord"))
	if got, _ := Current(e); got != "dracula" {
		t.Fatalf("the theme theme-switch had set was lost: %q", got)
	}
}

func TestSetSwapsOneLinkAndReloads(t *testing.T) {
	f := newFixture(t)
	e := f.env()
	must(t, Init(e, "nord"))
	f.ran = nil
	must(t, Set(e, "dracula"))
	for _, a := range Apps {
		if got := through(t, filepath.Join(f.repo, a.Pointer)); got != "dracula "+a.File {
			t.Fatalf("%s reads %q after the switch", a.Pointer, got)
		}
	}
	if !slices.ContainsFunc(f.ran, func(c []string) bool { return slices.Equal(c, []string{"sketchybar", "--reload"}) }) {
		t.Fatalf("sketchybar not reloaded: %v", f.ran)
	}
}

func TestSetRefusesAnUnknownTheme(t *testing.T) {
	f := newFixture(t)
	e := f.env()
	must(t, Init(e, "nord"))
	if err := Set(e, "solarized"); err == nil {
		t.Fatal("unknown theme accepted")
	}
	if got, _ := Current(e); got != "nord" {
		t.Fatalf("a refused switch changed the theme to %q", got)
	}
}

func TestList(t *testing.T) {
	f := newFixture(t)
	got, err := List(f.env())
	must(t, err)
	if !slices.Equal(got, []string{"dracula", "nord"}) {
		t.Fatalf("List = %v", got)
	}
}

// zellij's config.kdl is rendered from a template on every make up, which
// resets default_layout; Init (run on every switch) puts the theme back.
func TestZellijLayoutFollowsTheThemeAndSurvivesARender(t *testing.T) {
	f := newFixture(t)
	e := f.env()
	zdir := filepath.Join(f.repo, "home/shared/zellij/config")
	must(t, os.MkdirAll(filepath.Join(zdir, "layouts"), 0o755))
	for _, n := range []string{"nord", "dracula"} {
		must(t, os.WriteFile(filepath.Join(zdir, "layouts", n+".kdl"), nil, 0o644))
	}
	rendered := filepath.Join(zdir, "config.kdl")
	render := func() { must(t, os.WriteFile(rendered, []byte("theme \"x\"\ndefault_layout \"nord\"\n"), 0o644)) }
	render()
	must(t, os.MkdirAll(filepath.Join(f.home, ".config", "zellij"), 0o755))
	must(t, os.Symlink(rendered, filepath.Join(f.home, ".config", "zellij", "config.kdl")))

	must(t, Init(e, "nord"))
	must(t, Set(e, "dracula"))
	if got := through(t, rendered); got != "theme \"x\"\ndefault_layout \"dracula\"\n" {
		t.Fatalf("after set: %q", got)
	}
	if _, err := os.Readlink(filepath.Join(f.home, ".config", "zellij", "config.kdl")); err != nil {
		t.Fatal("the home-manager link was replaced by a file")
	}
	render()
	must(t, Init(e, "nord"))
	if got := through(t, rendered); got != "theme \"x\"\ndefault_layout \"dracula\"\n" {
		t.Fatalf("after a re-render and init: %q", got)
	}
}

func TestNothingReplacesARealFile(t *testing.T) {
	f := newFixture(t)
	e := f.env()
	must(t, Init(e, "nord"))
	mine := filepath.Join(f.repo, Apps[1].Pointer)
	must(t, os.Remove(mine))
	must(t, os.WriteFile(mine, []byte("hand edited"), 0o644))
	_ = Set(e, "dracula")
	if got := through(t, mine); got != "hand edited" {
		t.Fatalf("a real %s was replaced: %q", Apps[1].Pointer, got)
	}
}

func TestSetRefusesNamesOutsideThePalettes(t *testing.T) {
	f := newFixture(t)
	e := f.env()
	must(t, Init(e, "nord"))
	for _, bad := range []string{"..", ".", "", "a/b"} {
		if err := Set(e, bad); err == nil {
			t.Fatalf("Set(%q) accepted", bad)
		}
	}
	if got, _ := Current(e); got != "nord" {
		t.Fatalf("current moved to %q", got)
	}
}

package theme

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// omarchyFixture: a Linux machine with Omarchy, two palettes (one Omarchy
// ships as rose-pine, one it does not) and Omarchy's bundled tokyo-night
// wallpapers under $OMARCHY_PATH.
func omarchyFixture(t *testing.T) (*fixture, Env) {
	t.Helper()
	f := &fixture{home: t.TempDir(), repo: t.TempDir()}
	for _, name := range []string{"rosepine", "dracula", "tokyonight-day"} {
		must(t, os.MkdirAll(filepath.Join(f.home, ".config", "theme", "palettes", name), 0o755))
		copyFile(t, filepath.Join("testdata", "palette-dark.lua"), filepath.Join(f.repo, Apps[0].Source(name)))
	}
	must(t, os.MkdirAll(filepath.Join(f.repo, "home/shared/theme/wallpapers"), 0o755))
	must(t, os.WriteFile(filepath.Join(f.repo, "home/shared/theme/wallpapers/dracula.png"), nil, 0o644))
	omarchy := filepath.Join(t.TempDir(), "omarchy")
	bundled := filepath.Join(omarchy, "themes", "tokyo-night", "backgrounds")
	must(t, os.MkdirAll(bundled, 0o755))
	must(t, os.WriteFile(filepath.Join(bundled, "1-city.jpg"), nil, 0o644))
	e := f.env()
	e.Has = func(string) bool { return true }
	e.Getenv = func(k string) string {
		if k == "OMARCHY_PATH" {
			return omarchy
		}
		return ""
	}
	return f, e
}

func TestOmarchyUsesItsBundledThemeForTheSameFamily(t *testing.T) {
	f, e := omarchyFixture(t)
	must(t, applyOmarchy(e, "rosepine"))
	if !slices.ContainsFunc(f.ran, func(c []string) bool { return slices.Equal(c, []string{"omarchy", "theme", "set", "rose-pine"}) }) {
		t.Fatalf("ran: %v", f.ran)
	}
	if exists(filepath.Join(f.home, ".config/omarchy/themes/rosepine")) {
		t.Fatal("a bundled theme must not be generated")
	}
}

func TestOmarchyGeneratesTheThemesItLacks(t *testing.T) {
	f, e := omarchyFixture(t)
	must(t, applyOmarchy(e, "dracula"))
	if !slices.ContainsFunc(f.ran, func(c []string) bool { return slices.Equal(c, []string{"omarchy", "theme", "set", "dracula"}) }) {
		t.Fatalf("ran: %v", f.ran)
	}
	themes := filepath.Join(f.home, ".config/omarchy/themes")
	if !strings.Contains(through(t, filepath.Join(themes, "dracula/colors.toml")), `background = "#`) {
		t.Fatal("dracula's colors.toml was not written")
	}
	// the checkout's wallpaper, or the family's bundled ones
	if got, _ := os.Readlink(filepath.Join(themes, "dracula/backgrounds/dracula.png")); got != filepath.Join(f.repo, "home/shared/theme/wallpapers/dracula.png") {
		t.Fatalf("dracula background -> %q", got)
	}
	if got, _ := os.Readlink(filepath.Join(themes, "tokyonight-day/backgrounds/1-city.jpg")); !strings.HasSuffix(got, "themes/tokyo-night/backgrounds/1-city.jpg") {
		t.Fatalf("tokyonight-day background -> %q", got)
	}
}

func TestOmarchyThemesAreRewrittenOnlyWhenChanged(t *testing.T) {
	f, e := omarchyFixture(t)
	must(t, writeOmarchyThemes(e))
	colors := filepath.Join(f.home, ".config/omarchy/themes/dracula/colors.toml")
	old := time.Unix(1, 0)
	must(t, os.Chtimes(colors, old, old))
	must(t, writeOmarchyThemes(e))
	if info, err := os.Stat(colors); err != nil || !info.ModTime().Equal(old) {
		t.Fatalf("an unchanged colors.toml was rewritten: %v", err)
	}
}

func TestWithoutOmarchyNothingIsWritten(t *testing.T) {
	f, e := omarchyFixture(t)
	e.Has = func(c string) bool { return c != "omarchy" }
	must(t, applyOmarchy(e, "dracula"))
	if len(f.ran) != 0 || exists(filepath.Join(f.home, ".config/omarchy")) {
		t.Fatalf("ran %v", f.ran)
	}
}

func TestOmarchyColorsMatchGolden(t *testing.T) {
	for _, c := range []struct{ dir, palette string }{
		{"nord", "palette-dark.lua"},
		{"catppuccin-latte", "palette-light.lua"},
	} {
		p, err := readPalette(filepath.Join("testdata", c.palette))
		must(t, err)
		golden := filepath.Join("testdata", "golden", c.dir, "omarchy-colors.toml")
		got := colorsTOML(p)
		if *update {
			must(t, os.WriteFile(golden, []byte(got), 0o644))
			continue
		}
		if want := through(t, golden); got != want {
			t.Fatalf("%s:\n%s\nwant:\n%s", c.dir, got, want)
		}
	}
}

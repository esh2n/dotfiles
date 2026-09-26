package theme

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The checkout's real themes, checked for what a switch needs rather than
// for exact bytes: adding a theme changes no test, and a test fails only when
// the new theme is missing something — and says what.

var checkout = filepath.Join("..", "..", "..", "..")

func realThemes(t *testing.T) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(checkout, "home/shared/theme/themes/*.lua"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no themes found: %v", err)
	}
	var names []string
	for _, f := range files {
		names = append(names, strings.TrimSuffix(filepath.Base(f), ".lua"))
	}
	return names
}

// usedKeys is every palette key the generators read (h("key") in this
// package's sources), so a generator that starts reading a new colour
// makes every theme without it fail here.
func usedKeys(t *testing.T) []string {
	t.Helper()
	files, _ := filepath.Glob("*.go")
	seen := map[string]bool{}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range regexp.MustCompile(`\bh\("([a-z0-9]+)"\)`).FindAllSubmatch(b, -1) {
			seen[string(m[1])] = true
		}
	}
	var keys []string
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		t.Fatal("found no palette keys in the generators")
	}
	return keys
}

func TestEveryThemeHasEveryColourTheGeneratorsRead(t *testing.T) {
	keys := usedKeys(t)
	for _, name := range realThemes(t) {
		p, err := readPalette(filepath.Join(checkout, Apps[0].Source(name)))
		if err != nil {
			t.Fatal(err)
		}
		for _, k := range keys {
			if p.Hex(k) == "" {
				t.Errorf("%s.lua has no %q colour (the generators would write an empty one)", name, k)
			}
		}
	}
}

func TestEveryThemeIsInTheNameTables(t *testing.T) {
	for _, name := range realThemes(t) {
		for table, m := range map[string]map[string]string{
			"vscodeThemes": vscodeThemes, "nvchadThemes": nvchadThemes, "statuslineColors": statuslineColors,
		} {
			if _, ok := m[name]; !ok {
				t.Errorf("%s is missing from %s (apply.go)", name, table)
			}
		}
	}
}

// ownOrFamily: the theme's own file, else its family's (catppuccin-latte ->
// catppuccin) — the rule home/shared/theme/default.nix applies.
func ownOrFamily(name, pattern string) bool {
	for _, n := range []string{name, strings.SplitN(name, "-", 2)[0]} {
		if _, err := os.Stat(filepath.Join(checkout, strings.ReplaceAll(pattern, "%s", n))); err == nil {
			return true
		}
	}
	return false
}

func TestEveryThemeHasAFileForEveryApp(t *testing.T) {
	patterns := []string{
		"home/shared/zellij/config/layouts/%s.kdl.template",
		"home/darwin/warp/config/themes/%s.yaml",
	}
	for _, a := range Apps[1:] {
		patterns = append(patterns, a.source)
	}
	for _, name := range realThemes(t) {
		for _, pattern := range patterns {
			if !ownOrFamily(name, pattern) {
				t.Errorf("%s: no %s, nor its family's", name, pattern)
			}
		}
		if !ownOrFamily(name, "home/shared/theme/wallpapers/%s.png") && !ownOrFamily(name, "home/shared/theme/wallpapers/%s.jpg") {
			t.Errorf("%s: no wallpaper, nor its family's", name)
		}
	}
	starship, err := os.ReadFile(filepath.Join(checkout, "home/shared/starship/config/starship.toml.template"))
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range realThemes(t) {
		family := strings.SplitN(name, "-", 2)[0]
		if !strings.Contains(string(starship), "[palettes."+name+"]") && !strings.Contains(string(starship), "[palettes."+family+"]") {
			t.Errorf("%s: no Starship palette, nor its family's", name)
		}
	}
}

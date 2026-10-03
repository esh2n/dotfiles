package theme

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const omniwmFixture = `schemaVersion = 3

[appearance]
mode = "dark"

[borders]
enabled = true
width = 5.0

[borders.color]
alpha = 1.0
blue = 0.979300037944676
green = 1.0
red = 0.08458520228437894

[overview]
zoom = 1.0

[overview.backdrop]
alpha = 1.0
blue = 0.08
green = 0.05
red = 0.05

[overview.windowBorders]

[overview.windowBorders.hovered]
alpha = 1.0
blue = 1.0
green = 0.6
red = 0.4

[overview.windowBorders.normal]
alpha = 0.5
blue = 0.35
green = 0.3
red = 0.3

[overview.windowBorders.selected]
alpha = 1.0
blue = 0.4
green = 0.8
red = 0.3

[routing]
mode = "custom"
`

func omniwmRepo(t *testing.T, name, palette, borders string) (Env, string) {
	t.Helper()
	repo := t.TempDir()
	put := func(rel string, b []byte) string {
		path := filepath.Join(repo, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, b, 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	pal, err := os.ReadFile(filepath.Join("testdata", palette))
	if err != nil {
		t.Fatal(err)
	}
	put(Apps[0].Source(name), pal)
	put("home/darwin/borders/config/themes/"+name+".sh", []byte(borders))
	cfg := put("home/darwin/omniwm/config/settings.toml", []byte(omniwmFixture))
	return Env{Home: t.TempDir(), Repo: repo}, cfg
}

// section is the body of [name] in text, trimmed, so a test compares lines.
func section(t *testing.T, text, name string) string {
	t.Helper()
	i := strings.Index(text, "["+name+"]\n")
	if i < 0 {
		t.Fatalf("section [%s] missing", name)
	}
	rest := text[i+len(name)+3:]
	if j := strings.Index(rest, "\n["); j >= 0 {
		rest = rest[:j]
	}
	return strings.TrimSpace(rest)
}

func TestApplyOmniWMWritesPaletteAndBordersColours(t *testing.T) {
	// palette-dark.lua: base 202020, overlay0 505050; borders: a gradient
	e, cfg := omniwmRepo(t, "nord", "palette-dark.lua",
		"active_color=\"gradient(top_left=0xff102030,bottom_right=0xffeba0ac)\"\ninactive_color=\"gradient(top_left=0xff405060,bottom_right=0xff74c7ec)\"\n")
	if err := applyOmniWM(e, "nord"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(cfg)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	for name, want := range map[string]string{
		"borders.color":                   "alpha = 1.0\nblue = 0.18823529411764706\ngreen = 0.12549019607843137\nred = 0.06274509803921569\n",
		"overview.backdrop":               "alpha = 1.0\nblue = 0.12549019607843137\ngreen = 0.12549019607843137\nred = 0.12549019607843137\n",
		"overview.windowBorders.selected": "alpha = 1.0\nblue = 0.18823529411764706\ngreen = 0.12549019607843137\nred = 0.06274509803921569\n",
		"overview.windowBorders.hovered":  "alpha = 1.0\nblue = 0.3764705882352941\ngreen = 0.3137254901960784\nred = 0.25098039215686274\n",
		"overview.windowBorders.normal":   "alpha = 0.5\nblue = 0.3137254901960784\ngreen = 0.3137254901960784\nred = 0.3137254901960784\n",
		"appearance":                      "mode = \"dark\"\n",
		"routing":                         "mode = \"custom\"\n",
	} {
		if s := section(t, got, name); s != strings.TrimSpace(want) {
			t.Errorf("[%s]\n got: %q\nwant: %q", name, s, want)
		}
	}
	if !strings.Contains(got, "schemaVersion = 3\n") || !strings.Contains(got, "width = 5.0\n") {
		t.Errorf("unrelated lines were changed:\n%s", got)
	}
}

func TestApplyOmniWMPlainBordersAndLightVariant(t *testing.T) {
	e, cfg := omniwmRepo(t, "catppuccin-latte", "palette-light.lua",
		"active_color=\"0xff7aa2f7\"\ninactive_color=\"0xff565f89\"\n")
	if err := applyOmniWM(e, "catppuccin-latte"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(cfg)
	got := string(b)
	if s := section(t, got, "appearance"); !strings.Contains(s, "mode = \"light\"") {
		t.Errorf("appearance: %q", s)
	}
	if s := section(t, got, "borders.color"); !strings.Contains(s, "red = 0.47843137254901963") || !strings.Contains(s, "blue = 0.9686274509803922") {
		t.Errorf("borders.color: %q", s)
	}
	if s := section(t, got, "overview.windowBorders.hovered"); !strings.Contains(s, "red = 0.33725490196078434") {
		t.Errorf("hovered: %q", s)
	}
}

func TestApplyOmniWMSkipsMachinesWithoutIt(t *testing.T) {
	e := Env{Home: t.TempDir(), Repo: t.TempDir()}
	if err := applyOmniWM(e, "nord"); err != nil {
		t.Fatalf("no settings.toml must be a silent skip, got %v", err)
	}
	e.Has = func(c string) bool { return c == "omarchy" }
	if err := applyOmniWM(e, "nord"); err != nil {
		t.Fatalf("omarchy must be a silent skip, got %v", err)
	}
}

func TestApplyOmniWMWarnsWhenBordersThemeMissing(t *testing.T) {
	e, cfg := omniwmRepo(t, "nord", "palette-dark.lua", "")
	if err := os.Remove(filepath.Join(e.Repo, "home/darwin/borders/config/themes/nord.sh")); err != nil {
		t.Fatal(err)
	}
	var warned []string
	e.Warn = func(m string) { warned = append(warned, m) }
	if err := applyOmniWM(e, "nord"); err != nil {
		t.Fatal(err)
	}
	if len(warned) != 1 || !strings.Contains(warned[0], "borders") {
		t.Errorf("want one warning naming borders, got %v", warned)
	}
	b, _ := os.ReadFile(cfg)
	if string(b) != omniwmFixture {
		t.Errorf("settings must be left alone when the colours are unknown")
	}
}

func TestApplyOmniWMSecondRunChangesNothing(t *testing.T) {
	e, cfg := omniwmRepo(t, "nord", "palette-dark.lua", "active_color=\"0xff102030\"\ninactive_color=\"0xff405060\"\n")
	if err := os.Chmod(cfg, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := applyOmniWM(e, "nord"); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o644 {
		t.Errorf("the rewritten file is %v, want 0644 (OmniWM reads it, git tracks it)", st.Mode().Perm())
	}
	first, _ := os.ReadFile(cfg)
	if err := applyOmniWM(e, "nord"); err != nil {
		t.Fatal(err)
	}
	again, _ := os.ReadFile(cfg)
	if string(first) != string(again) {
		t.Errorf("second run changed the file")
	}
	if st2, _ := os.Stat(cfg); !st2.ModTime().Equal(st.ModTime()) {
		t.Errorf("second run rewrote an unchanged file (OmniWM would reload for nothing)")
	}
}

func TestApplyOmniWMWarnsOnMissingSectionAndBadPaletteKey(t *testing.T) {
	e, cfg := omniwmRepo(t, "nord", "palette-dark.lua", "active_color=\"0xff102030\"\ninactive_color=\"0xff405060\"\n")
	// OmniWM stops writing one section; the palette loses overlay0
	trimmed := strings.Replace(omniwmFixture, "[overview.backdrop]\nalpha = 1.0\nblue = 0.08\ngreen = 0.05\nred = 0.05\n\n", "", 1)
	if err := os.WriteFile(cfg, []byte(trimmed), 0o644); err != nil {
		t.Fatal(err)
	}
	pal := filepath.Join(e.Repo, Apps[0].Source("nord"))
	b, _ := os.ReadFile(pal)
	if err := os.WriteFile(pal, []byte(strings.Replace(string(b), "overlay0", "overlayX", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	var warned []string
	e.Warn = func(m string) { warned = append(warned, m) }
	if err := applyOmniWM(e, "nord"); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(warned, "\n")
	for _, want := range []string{"overview.backdrop.red", "overview.windowBorders.normal keeps its colour"} {
		if !strings.Contains(joined, want) {
			t.Errorf("want a warning mentioning %q, got %q", want, joined)
		}
	}
	got, _ := os.ReadFile(cfg)
	if s := section(t, string(got), "borders.color"); !strings.Contains(s, "red = 0.06274509803921569") {
		t.Errorf("the sections that exist must still be written: %q", s)
	}
	if s := section(t, string(got), "overview.windowBorders.normal"); !strings.HasSuffix(s, "red = 0.3") {
		t.Errorf("a section without a colour must keep its old values: %q", s)
	}
}

func TestBordersColoursRejectsAFileWithoutThem(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.sh")
	if err := os.WriteFile(path, []byte("active_color=\"red\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := bordersColours(path); err == nil {
		t.Error("want an error for a colour that is not 0xAARRGGBB")
	}
}

// The checkout's real borders themes, one per palette, read as applyOmniWM
// reads them: a theme without one leaves OmniWM's colours behind.
func TestEveryThemeHasBordersColours(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	palettes, err := filepath.Glob(filepath.Join(root, "home/shared/theme/themes/*.lua"))
	if err != nil || len(palettes) == 0 {
		t.Fatalf("no themes found: %v", err)
	}
	for _, pal := range palettes {
		name := strings.TrimSuffix(filepath.Base(pal), ".lua")
		a, i, err := bordersColours(filepath.Join(root, "home/darwin/borders/config/themes", name+".sh"))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if len(a) != 6 || len(i) != 6 {
			t.Errorf("%s: active %q inactive %q", name, a, i)
		}
	}
}

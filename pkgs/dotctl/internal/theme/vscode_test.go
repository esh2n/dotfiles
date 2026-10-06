package theme

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyVSCodeWarnsOnABrokenSettingsLink(t *testing.T) {
	home := t.TempDir()
	link := filepath.Join(home, "Library/Application Support/Cursor/User/settings.json")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(home, "gone/settings.json"), link); err != nil {
		t.Fatal(err)
	}
	var warned []string
	e := Env{Home: home, Warn: func(m string) { warned = append(warned, m) }}
	if err := applyVSCode(e, "everforest"); err != nil {
		t.Fatal(err)
	}
	if len(warned) != 1 || !strings.Contains(warned[0], "Cursor/User/settings.json") {
		t.Errorf("want one warning naming the broken link, got %v", warned)
	}
}

func TestApplyVSCodeSkipsAnEditorThatIsNotThere(t *testing.T) {
	var warned []string
	e := Env{Home: t.TempDir(), Warn: func(m string) { warned = append(warned, m) }}
	if err := applyVSCode(e, "everforest"); err != nil {
		t.Fatal(err)
	}
	if len(warned) != 0 {
		t.Errorf("a missing editor must be a silent skip, got %v", warned)
	}
}

func TestApplyVSCodeRewritesThroughTheLink(t *testing.T) {
	home := t.TempDir()
	real := filepath.Join(home, "repo/settings.json")
	if err := os.MkdirAll(filepath.Dir(real), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(real, []byte(`{"workbench.colorTheme": "Catppuccin Mocha"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(home, "Library/Application Support/Cursor/User/settings.json")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	if err := applyVSCode(Env{Home: home}, "everforest"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(real)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"workbench.colorTheme": "Everforest Dark"`) {
		t.Errorf("theme not written through the link: %s", b)
	}
}

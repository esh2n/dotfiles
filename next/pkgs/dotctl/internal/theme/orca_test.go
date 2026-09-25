package theme

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func orcaStore(t *testing.T, profile, data string) (string, string) {
	t.Helper()
	support := t.TempDir()
	index := `{}`
	if profile != "" {
		index = `{"activeProfileId": "` + profile + `"}`
	} else {
		profile = "local-default"
	}
	if err := os.WriteFile(filepath.Join(support, "orca-profile-index.json"), []byte(index), 0o644); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(support, "profiles", profile, "orca-data.json")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	return support, file
}

func TestOrcaApplySetsThemeAndTerminalForTheVariant(t *testing.T) {
	support, file := orcaStore(t, "p1", `{"settings": {"theme": "dark", "fontSize": 13, "other": "<keep>"}, "big": 12345678901234567890}`)
	applied, err := OrcaApply(support, "light", "Rosé Pine Dawn")
	if err != nil || applied != "ui:light, terminalThemeLight:Rosé Pine Dawn" {
		t.Fatalf("%q %v", applied, err)
	}
	b, _ := os.ReadFile(file)
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	s := got["settings"].(map[string]any)
	if s["theme"] != "light" || s["terminalThemeLight"] != "Rosé Pine Dawn" || s["other"] != "<keep>" || s["fontSize"] != float64(13) {
		t.Fatalf("settings %v", s)
	}
	if !strings.Contains(string(b), "12345678901234567890") || !strings.Contains(string(b), "<keep>") {
		t.Fatalf("numbers or text rewritten: %s", b)
	}
	if applied, err := OrcaApply(support, "dark", ""); err != nil || applied != "ui:dark" {
		t.Fatalf("%q %v", applied, err)
	}
}

func TestOrcaApplyRefusesAnUnknownShape(t *testing.T) {
	support, file := orcaStore(t, "", `{"prefs": {}}`)
	if _, err := OrcaApply(support, "dark", "x"); err == nil || !strings.Contains(err.Error(), "refusing") {
		t.Fatalf("got %v", err)
	}
	if b, _ := os.ReadFile(file); string(b) != `{"prefs": {}}` {
		t.Fatal("refused file was written")
	}
	support, _ = orcaStore(t, "../x", `{}`)
	if _, err := OrcaApply(support, "dark", ""); err == nil {
		t.Fatal("a profile id leaving the directory is used")
	}
	if _, err := OrcaApply(t.TempDir(), "dark", ""); err == nil {
		t.Fatal("no index")
	}
}

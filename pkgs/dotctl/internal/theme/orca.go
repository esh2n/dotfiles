package theme

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// OrcaApply sets Orca's UI theme (dark or light) and, when warpName is not
// empty, the terminal theme for that variant, in Orca's settings store
// (was domains/system/bin/orca-theme-apply.py).
//
// Orca (onorca.dev) keeps every setting in one JSON at
// profiles/<activeProfileId>/orca-data.json under its Electron userData dir;
// it has no CLI, IPC or deep link to change them, and the running app owns
// the file (the caller refuses while Orca runs). Terminal themes are Warp
// themes, named by their yaml `name:`. The write is atomic, and a file whose
// settings block does not look like Orca's is refused, so an app update
// that reshapes the store fails loudly instead of being corrupted. It
// returns what it set.
func OrcaApply(support, variant, warpName string) (string, error) {
	var index struct {
		ActiveProfileID string `json:"activeProfileId"`
	}
	b, err := os.ReadFile(filepath.Join(support, "orca-profile-index.json"))
	if err != nil {
		return "", err
	}
	if err := json.Unmarshal(b, &index); err != nil {
		return "", fmt.Errorf("orca-profile-index.json: %w", err)
	}
	profile := index.ActiveProfileID
	if profile == "" {
		profile = "local-default"
	}
	if filepath.Base(profile) != profile || profile == ".." {
		return "", fmt.Errorf("orca: unexpected profile id %q", profile)
	}
	dataPath := filepath.Join(support, "profiles", profile, "orca-data.json")
	raw, err := os.ReadFile(dataPath)
	if err != nil {
		return "", err
	}
	var data map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber() // keep numbers exactly as Orca wrote them
	if err := dec.Decode(&data); err != nil {
		return "", fmt.Errorf("orca-data.json: %w", err)
	}
	settings, ok := data["settings"].(map[string]any)
	if !ok || settings["theme"] == nil {
		return "", errors.New("orca: settings block not found — Orca's schema changed, refusing to write")
	}
	ui, key := "dark", "terminalThemeDark"
	if variant == "light" {
		ui, key = "light", "terminalThemeLight"
	}
	settings["theme"] = ui
	applied := "ui:" + ui
	if warpName != "" {
		settings[key] = warpName
		applied += ", " + key + ":" + warpName
	}
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(data); err != nil {
		return "", err
	}
	return applied, writeAtomic(dataPath, out.Bytes())
}

// writeAtomic replaces a file through a temporary file beside it, keeping
// the file's mode (CreateTemp makes 0600; a 0644 file must stay readable).
func writeAtomic(path string, b []byte) error {
	mode := os.FileMode(0o644)
	if st, err := os.Stat(path); err == nil {
		mode = st.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".")
	if err != nil {
		return err
	}
	_, err = tmp.Write(b)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp.Name(), mode)
	}
	if err == nil {
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		_ = os.Remove(tmp.Name())
	}
	return err
}

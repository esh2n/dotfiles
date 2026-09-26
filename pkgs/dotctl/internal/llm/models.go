package llm

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
)

// ggufModel is one entry of home/linux/llama-server/models.json.
type ggufModel struct {
	File   string `json:"file"`
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

func readModelList(path string) ([]ggufModel, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Models []ggufModel `json:"models"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	for _, m := range doc.Models {
		if m.File == "" || filepath.Base(m.File) != m.File || !strings.HasSuffix(m.File, ".gguf") {
			return nil, fmt.Errorf("%s: %q is not a .gguf file name", path, m.File)
		}
		if !strings.HasPrefix(m.URL, "https://") || m.Size <= 0 || len(m.SHA256) != 64 {
			return nil, fmt.Errorf("%s: %s needs an https url, a size and a sha256", path, m.File)
		}
	}
	return doc.Models, nil
}

// fetchModels puts every model of the list into ~/models, where
// llama-server's router finds them. A file of the listed size is taken as
// present (hashing 17GB on every make up is not worth it); a download goes
// to <file>.part, resumes an earlier one, and is renamed only once its
// sha256 matches.
func fetchModels(e Env, add func(string, ...any)) {
	list, err := readModelList(filepath.Join(e.Repo, "home", "linux", "llama-server", "models.json"))
	if err != nil {
		add("llama-server models: %v", err)
		return
	}
	dir := filepath.Join(e.Home, "models")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		add("llama-server models: %v", err)
		return
	}
	for _, m := range list {
		dest := filepath.Join(dir, m.File)
		if info, err := os.Stat(dest); err == nil && info.Size() == m.Size {
			continue
		}
		if err := fetchModel(e, m, dest); err != nil {
			add("llama-server model %s: %v", m.File, err)
			continue
		}
		e.UI.Success("fetched %s", m.File)
	}
}

func fetchModel(e Env, m ggufModel, dest string) error {
	part := dest + ".part"
	e.UI.Note("downloading %s (%.1f GB) into %s", m.File, float64(m.Size)/1e9, filepath.Dir(dest))
	// no timeout: 17GB takes as long as the line allows; -C - resumes
	if _, errOut, err := e.Sys.Exec(sys.Cmd{Name: "curl", Args: []string{"-fL", "--retry", "3", "-C", "-", "-o", part, m.URL}}); err != nil {
		return fmt.Errorf("curl: %v: %s", err, strings.TrimSpace(errOut))
	}
	sum, err := fileSHA256(part)
	if err != nil {
		return err
	}
	if sum != m.SHA256 {
		if err := os.Remove(part); err != nil {
			return fmt.Errorf("sha256 %s, want %s; removing the download: %w", sum, m.SHA256, err)
		}
		return fmt.Errorf("sha256 %s, want %s; the download was removed", sum, m.SHA256)
	}
	return os.Rename(part, dest)
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

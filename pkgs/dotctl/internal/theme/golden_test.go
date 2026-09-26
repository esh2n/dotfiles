package theme

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
)

// The files a switch writes, held against testdata/golden. The palettes are
// made up (testdata/palette-*.lua), so adding a theme or changing a theme's
// colours never touches these: they change only when a generator does, and
// then `go test ./internal/theme -update` rewrites them for the diff to be
// read in review.
var update = flag.Bool("update", false, "rewrite testdata/golden from the current output")

// written: golden name -> where the switch writes it (checkout- or home-relative)
var written = map[string]struct {
	inHome bool
	path   string
}{
	"lazyvim-colorscheme.lua":  {false, "home/shared/nvim/lazyvim/lua/plugins/colorscheme.lua"},
	"nvchad-chadrc.lua":        {false, "home/shared/nvim/nvchad/lua/chadrc.lua"},
	"astrovim-colorscheme.lua": {false, "home/shared/nvim/astrovim/lua/plugins/colorscheme.lua"},
	"custom-colorscheme.lua":   {false, "home/shared/nvim/custom/lua/custom/colorscheme.lua"},
	"current.sh":               {false, "home/shared/theme/env/current.sh"},
	"ripgreprc":                {false, "home/shared/theme/env/ripgreprc"},
	"delta-theme.gitconfig":    {true, ".config/git/delta-theme.gitconfig"},
}

func TestGeneratedFilesMatchGolden(t *testing.T) {
	for _, c := range []struct{ name, palette string }{
		{"nord", "palette-dark.lua"},
		{"catppuccin-latte", "palette-light.lua"},
	} {
		t.Run(c.name, func(t *testing.T) {
			home, repo := t.TempDir(), t.TempDir()
			copyFile(t, filepath.Join("testdata", c.palette), filepath.Join(repo, Apps[0].Source(c.name)))
			for _, d := range []string{
				"home/shared/nvim/lazyvim/lua/plugins", "home/shared/nvim/nvchad",
				"home/shared/nvim/astrovim/lua/plugins", "home/shared/nvim/custom/lua/custom",
			} {
				mkdir(t, filepath.Join(repo, d))
			}
			e := Env{Home: home, Repo: repo}
			if err := applyNeovim(e, c.name); err != nil {
				t.Fatal(err)
			}
			if err := applyCLI(e, c.name); err != nil {
				t.Fatal(err)
			}
			for golden, at := range written {
				root := repo
				if at.inHome {
					root = home
				}
				got, err := os.ReadFile(filepath.Join(root, at.path))
				if err != nil {
					t.Fatalf("%s was not written: %v", at.path, err)
				}
				want := filepath.Join("testdata", "golden", c.name, golden)
				if *update {
					mkdir(t, filepath.Dir(want))
					if err := os.WriteFile(want, got, 0o644); err != nil {
						t.Fatal(err)
					}
					continue
				}
				expected, err := os.ReadFile(want)
				if err != nil {
					t.Fatalf("%v (run with -update to create it)", err)
				}
				if string(got) != string(expected) {
					t.Errorf("%s differs from %s (-update rewrites it):\n--- got\n%s\n--- want\n%s", at.path, want, got, expected)
				}
			}
		})
	}
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	b, err := os.ReadFile(from)
	if err != nil {
		t.Fatal(err)
	}
	mkdir(t, filepath.Dir(to))
	if err := os.WriteFile(to, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func mkdir(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
}

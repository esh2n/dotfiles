package setup

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestOmarchyThemesInstallsOnlyMissing(t *testing.T) {
	w := newWorld(t, "omarchy", "omarchy-theme-install")
	write(t, filepath.Join(w.repo, "home", "linux", "omarchy-shell", "themes"),
		"# themes from git\n\nhttps://github.com/HANCORE-linux/omarchy-dos-moos-theme.git\nhttps://github.com/example/Omarchy-Blue-Theme\n")
	write(t, filepath.Join(w.home, ".config", "omarchy", "themes", "dos-moos", "colors.toml"), "")
	if err := Run(w.env, "omarchy-themes"); err != nil {
		t.Fatal(err)
	}
	want := []string{"omarchy-theme-install https://github.com/example/Omarchy-Blue-Theme"}
	if strings.Join(w.sys.calls, "|") != strings.Join(want, "|") {
		t.Fatalf("calls %v, want %v", w.sys.calls, want)
	}
}

func TestOmarchyThemesWarnsOnAFailedInstall(t *testing.T) {
	w := newWorld(t, "omarchy", "omarchy-theme-install")
	write(t, filepath.Join(w.repo, "home", "linux", "omarchy-shell", "themes"),
		"https://github.com/a/omarchy-one-theme.git\nhttps://github.com/b/omarchy-two-theme.git\n")
	w.sys.fail["omarchy-theme-install https://github.com/a/"] = errors.New("exit status 1")
	if err := Run(w.env, "omarchy-themes"); err != nil {
		t.Fatal(err)
	}
	if !w.sys.ran("omarchy-theme-install https://github.com/b/omarchy-two-theme.git") {
		t.Fatalf("a failure must not stop the rest: %v", w.sys.calls)
	}
	if !strings.Contains(w.out.String(), "[WARN]") {
		t.Fatalf("a failure must warn: %q", w.out.String())
	}
}

func TestOmarchyThemesDoesNothingWithoutOmarchy(t *testing.T) {
	w := newWorld(t)
	if err := Run(w.env, "omarchy-themes"); err != nil || len(w.sys.calls) != 0 {
		t.Fatalf("%v %v", err, w.sys.calls)
	}
}

func TestOmarchyThemeName(t *testing.T) {
	for url, want := range map[string]string{
		"https://github.com/HANCORE-linux/omarchy-dos-moos-theme.git": "dos-moos",
		"https://github.com/x/Omarchy-Blue-Theme":                     "blue",
		"https://github.com/x/plain.git":                              "plain",
	} {
		if got := omarchyThemeName(url); got != want {
			t.Errorf("%s: got %q, want %q", url, got, want)
		}
	}
}

func TestQuickshellRiseDoesNothingWithoutOmarchy(t *testing.T) {
	w := newWorld(t)
	if err := Run(w.env, "quickshell-rise"); err != nil || len(w.sys.calls) != 0 {
		t.Fatalf("%v %v", err, w.sys.calls)
	}
}

func TestQuickshellRiseKeepsAnInstalledBar(t *testing.T) {
	w := newWorld(t, "omarchy", "qs")
	write(t, filepath.Join(w.home, ".config", "quickshell", "bar", ".qsrise"), "V1\n")
	if err := Run(w.env, "quickshell-rise"); err != nil || len(w.sys.calls) != 0 {
		t.Fatalf("%v %v", err, w.sys.calls)
	}
}

func TestQuickshellRiseNamesTheMissingFontAndSkips(t *testing.T) {
	w := newWorld(t, "omarchy", "qs", "fc-list")
	w.sys.outputs["fc-list"] = "/usr/share/fonts/JetBrainsMonoNerdFont.ttf: JetBrainsMono Nerd Font\n"
	if err := Run(w.env, "quickshell-rise"); err != nil {
		t.Fatal(err)
	}
	if len(w.sys.calls) != 1 {
		t.Fatalf("only the font check may run: %v", w.sys.calls)
	}
	if !strings.Contains(w.out.String(), "sudo pacman -S ttf-material-symbols-variable") {
		t.Fatalf("the warning must name the install command: %q", w.out.String())
	}
}

func TestQuickshellRiseInstallsV1WithAutostartAndNoAIBackend(t *testing.T) {
	w := newWorld(t, "omarchy", "qs", "fc-list")
	w.sys.outputs["fc-list"] = "a: JetBrainsMono Nerd Font\nb: Material Symbols Rounded\n"
	if err := Run(w.env, "quickshell-rise"); err != nil {
		t.Fatal(err)
	}
	if len(w.sys.calls) != 3 {
		t.Fatalf("calls %v", w.sys.calls)
	}
	if !strings.HasPrefix(w.sys.calls[1], "curl -fsSL -o ") || !strings.HasSuffix(w.sys.calls[1], quickshellRiseInstaller) {
		t.Fatalf("download %q", w.sys.calls[1])
	}
	if !strings.HasPrefix(w.sys.calls[2], "bash ") || !strings.HasSuffix(w.sys.calls[2], " V1 --autostart --no-ai-backend") {
		t.Fatalf("install %q", w.sys.calls[2])
	}
}

func TestQuickshellRiseWarnsWhenTheDownloadFails(t *testing.T) {
	w := newWorld(t, "omarchy", "qs", "fc-list")
	w.sys.outputs["fc-list"] = "a: JetBrainsMono Nerd Font\nb: Material Symbols Rounded\n"
	w.sys.fail["curl"] = errors.New("exit status 22")
	if err := Run(w.env, "quickshell-rise"); err != nil {
		t.Fatal(err)
	}
	for _, c := range w.sys.calls {
		if strings.HasPrefix(c, "bash ") {
			t.Fatalf("must not run a failed download: %v", w.sys.calls)
		}
	}
	if !strings.Contains(w.out.String(), "[WARN]") {
		t.Fatalf("out %q", w.out.String())
	}
}

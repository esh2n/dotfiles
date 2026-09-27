package up

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// fakeSys records every command and answers from a script.
type fakeSys struct {
	os      string
	calls   []string
	have    map[string]bool
	outputs map[string]string // command prefix -> stdout
	fail    map[string]bool   // command prefix -> error
	shells  string
}

func (f *fakeSys) record(env []string, name string, args []string) string {
	line := strings.TrimSpace(strings.Join(append([]string{name}, args...), " "))
	if len(env) > 0 {
		line = "[" + strings.Join(env, " ") + "] " + line
	}
	f.calls = append(f.calls, line)
	return strings.Join(append([]string{name}, args...), " ")
}

func (f *fakeSys) match(m map[string]bool, cmd string) bool {
	for k, v := range m {
		if v && strings.HasPrefix(cmd, k) {
			return true
		}
	}
	return false
}

func (f *fakeSys) Run(env []string, name string, args ...string) error {
	cmd := f.record(env, name, args)
	if name == "/bin/bash" {
		f.have["brew"] = true // the Homebrew installer ran
	}
	if f.match(f.fail, cmd) {
		return errors.New("failed")
	}
	return nil
}

func (f *fakeSys) Output(name string, args ...string) (string, error) {
	cmd := f.record(nil, name, args)
	if f.match(f.fail, cmd) {
		return "", errors.New("failed")
	}
	for k, v := range f.outputs {
		if strings.HasPrefix(cmd, k) {
			return v, nil
		}
	}
	return "", nil
}

func (f *fakeSys) Quiet(name string, args ...string) error {
	cmd := f.record([]string{"quiet"}, name, args)
	if f.match(f.fail, cmd) {
		return errors.New("failed")
	}
	return nil
}

func (f *fakeSys) Has(name string) bool { return f.have[name] }
func (f *fakeSys) OS() string           { return f.os }
func (f *fakeSys) Shells() string       { return f.shells }

func setup(t *testing.T, osName string) (*fakeSys, Config) {
	t.Helper()
	t.Setenv("NIX_CONFIG", "") // the recorded calls must not depend on the caller's shell
	home := t.TempDir()
	repo := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(home, ".config", "dotfiles"), 0o755))
	must(t, os.WriteFile(filepath.Join(home, ".config", "dotfiles", "roles.json"), []byte(`{"roles":["developer"]}`), 0o644))
	f := &fakeSys{
		os:      osName,
		have:    map[string]bool{"nix": true, "brew": true, "mise": true, "zsh": true},
		outputs: map[string]string{"nix --extra-experimental-features nix-command flakes build": "/nix/store/sys\n", "nix --extra-experimental-features nix-command flakes eval": "a/tap b/tap"},
		fail:    map[string]bool{},
		shells:  "/bin/zsh\n",
	}
	return f, Config{Home: home, Repo: repo, User: "u", Shell: "/bin/zsh", ZshPath: "/bin/zsh", EtcDir: t.TempDir()}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// withFlakes is how a nix call is recorded: with NIX_CONFIG turning flakes on
// for the nix it runs underneath (home-manager's own calls).
const withFlakes = "[NIX_CONFIG=extra-experimental-features = nix-command flakes] "

func index(calls []string, prefix string) int {
	return slices.IndexFunc(calls, func(c string) bool { return strings.HasPrefix(c, prefix) })
}

func TestMacBuildsAsTheUserAndActivatesAsRoot(t *testing.T) {
	f, c := setup(t, "darwin")
	must(t, Run(f, c))
	flake := c.Repo
	build := index(f.calls, "nix --extra-experimental-features nix-command flakes build --no-link --print-out-paths --impure "+flake+"#darwinConfigurations.mac.system")
	setProfile := index(f.calls, "sudo -H /nix/store/sys/sw/bin/nix-env -p /nix/var/nix/profiles/system --set /nix/store/sys")
	activate := index(f.calls, "sudo -H /nix/store/sys/activate")
	if build < 0 || setProfile < 0 || activate < 0 || !(build < setProfile && setProfile < activate) {
		t.Fatalf("order wrong: %v", f.calls)
	}
	if index(f.calls, "sudo nix") >= 0 || index(f.calls, "sudo -H nix") >= 0 {
		t.Fatalf("nix itself ran as root: %v", f.calls)
	}
}

func TestMacTrustsTheFlakesTapsBeforeActivating(t *testing.T) {
	f, c := setup(t, "darwin")
	must(t, Run(f, c))
	trust := index(f.calls, "brew trust --tap a/tap b/tap")
	noXDG := index(f.calls, "[XDG_CONFIG_HOME=] brew trust --tap a/tap b/tap")
	if trust < 0 || noXDG < 0 || trust > index(f.calls, "sudo -H /nix/store/sys/activate") {
		t.Fatalf("taps: %v", f.calls)
	}
}

func TestMacInstallsHomebrewWhenMissingNeverOnLinux(t *testing.T) {
	f, c := setup(t, "darwin")
	f.have["brew"] = false
	must(t, Run(f, c))
	if index(f.calls, "/bin/bash -c") < 0 {
		t.Fatalf("Homebrew not installed: %v", f.calls)
	}
	f, c = setup(t, "linux")
	f.have["brew"] = false
	must(t, Run(f, c))
	if index(f.calls, "/bin/bash -c") >= 0 {
		t.Fatalf("Homebrew installed on Linux: %v", f.calls)
	}
}

func TestLinuxSwitchesHomeManagerWithBackups(t *testing.T) {
	f, c := setup(t, "linux")
	must(t, Run(f, c))
	flake := c.Repo
	if index(f.calls, withFlakes+"nix --extra-experimental-features nix-command flakes run "+flake+"#home-manager -- switch --flake "+flake+"#linux --impure -b pre-dotfiles") < 0 {
		t.Fatalf("no home-manager switch: %v", f.calls)
	}
	if index(f.calls, "sudo") >= 0 {
		t.Fatalf("root on Linux without a gpu: %v", f.calls)
	}
}

func TestRuntimesComeAfterTheSwitch(t *testing.T) {
	f, c := setup(t, "linux")
	must(t, Run(f, c))
	if m, s := index(f.calls, "mise install"), index(f.calls, "nix "); m < 0 || m < s {
		t.Fatalf("mise: %v", f.calls)
	}
}

func TestAFailedBuildStopsBeforeRoot(t *testing.T) {
	f, c := setup(t, "darwin")
	f.fail["nix --extra-experimental-features nix-command flakes build"] = true
	if err := Run(f, c); err == nil {
		t.Fatal("a failed build did not stop the run")
	}
	if index(f.calls, "sudo") >= 0 || index(f.calls, "mise") >= 0 {
		t.Fatalf("went on after the failure: %v", f.calls)
	}
}

func TestNoRolesFileStopsBeforeAnything(t *testing.T) {
	f, c := setup(t, "darwin")
	must(t, os.Remove(filepath.Join(c.Home, ".config", "dotfiles", "roles.json")))
	err := Run(f, c)
	if err == nil || !strings.Contains(err.Error(), "roles.json") {
		t.Fatalf("err = %v", err)
	}
	if len(f.calls) != 0 {
		t.Fatalf("ran commands: %v", f.calls)
	}
}

func TestRolesFileOverride(t *testing.T) {
	f, c := setup(t, "linux")
	must(t, os.Remove(filepath.Join(c.Home, ".config", "dotfiles", "roles.json")))
	other := filepath.Join(t.TempDir(), "r.json")
	must(t, os.WriteFile(other, []byte(`{"roles":[]}`), 0o644))
	c.RolesFile = other
	must(t, Run(f, c))
}

func TestLoginShellBecomesZshOnlyWhenListed(t *testing.T) {
	f, c := setup(t, "darwin")
	c.Shell = "/bin/bash"
	must(t, Run(f, c))
	if index(f.calls, "chsh -s /bin/zsh") < 0 {
		t.Fatalf("no chsh: %v", f.calls)
	}
	f, c = setup(t, "linux")
	c.Shell, c.ZshPath, f.shells = "/bin/bash", "/home/u/.nix-profile/bin/zsh", "/bin/bash\n"
	var warned []string
	c.Warn = func(s string) { warned = append(warned, s) }
	must(t, Run(f, c))
	if index(f.calls, "chsh") >= 0 || !slices.ContainsFunc(warned, func(s string) bool { return strings.Contains(s, "/etc/shells") }) {
		t.Fatalf("calls %v warned %v", f.calls, warned)
	}
}

func TestGPUDriverSetupRunsWhenTheUnitIsNotThisGeneration(t *testing.T) {
	f, c := setup(t, "linux")
	pkg := filepath.Join(t.TempDir(), "non-nixos-gpu")
	must(t, os.MkdirAll(filepath.Join(pkg, "bin"), 0o755))
	must(t, os.MkdirAll(filepath.Join(pkg, "lib/systemd/system"), 0o755))
	must(t, os.WriteFile(filepath.Join(pkg, "bin/non-nixos-gpu-setup"), nil, 0o755))
	must(t, os.MkdirAll(filepath.Join(c.Home, ".nix-profile/bin"), 0o755))
	must(t, os.Symlink(filepath.Join(pkg, "bin/non-nixos-gpu-setup"), filepath.Join(c.Home, ".nix-profile/bin/non-nixos-gpu-setup")))
	c.GPUUnit = filepath.Join(t.TempDir(), "absent.service")
	must(t, Run(f, c))
	if index(f.calls, "sudo "+filepath.Join(c.Home, ".nix-profile/bin/non-nixos-gpu-setup")) < 0 {
		t.Fatalf("gpu setup not run: %v", f.calls)
	}
}

func TestAPlainEtcZshrcIsMovedAsideOnce(t *testing.T) {
	f, c := setup(t, "darwin")
	must(t, os.WriteFile(filepath.Join(c.EtcDir, "zshrc"), nil, 0o644))
	must(t, Run(f, c))
	if index(f.calls, "sudo mv "+filepath.Join(c.EtcDir, "zshrc")) < 0 {
		t.Fatalf("not moved aside: %v", f.calls)
	}
	f, c2 := setup(t, "darwin")
	c2.EtcDir = c.EtcDir
	must(t, os.WriteFile(filepath.Join(c.EtcDir, "zshrc.before-nix-darwin"), nil, 0o644))
	must(t, Run(f, c2))
	if index(f.calls, "sudo mv") >= 0 {
		t.Fatalf("moved twice: %v", f.calls)
	}
}

func TestAFailedEtcMoveStopsBeforeTheBuild(t *testing.T) {
	f, c := setup(t, "darwin")
	must(t, os.WriteFile(filepath.Join(c.EtcDir, "zshrc"), nil, 0o644))
	f.fail["sudo mv"] = true
	if err := Run(f, c); err == nil {
		t.Fatal("went on after the move failed")
	}
	if index(f.calls, "nix --extra-experimental-features nix-command flakes build") >= 0 {
		t.Fatalf("built anyway: %v", f.calls)
	}
}

func TestTheTrustProbeIsQuiet(t *testing.T) {
	f, c := setup(t, "darwin")
	must(t, Run(f, c))
	if index(f.calls, "[quiet] brew trust --help") < 0 || index(f.calls, "brew trust --help") >= 0 {
		t.Fatalf("probe: %v", f.calls)
	}
}

func TestANonExecutableGPUSetupIsSkipped(t *testing.T) {
	f, c := setup(t, "linux")
	pkg := filepath.Join(t.TempDir(), "p")
	must(t, os.MkdirAll(filepath.Join(pkg, "bin"), 0o755))
	must(t, os.WriteFile(filepath.Join(pkg, "bin/non-nixos-gpu-setup"), nil, 0o644))
	must(t, os.MkdirAll(filepath.Join(c.Home, ".nix-profile/bin"), 0o755))
	must(t, os.Symlink(filepath.Join(pkg, "bin/non-nixos-gpu-setup"), filepath.Join(c.Home, ".nix-profile/bin/non-nixos-gpu-setup")))
	must(t, Run(f, c))
	if index(f.calls, "sudo") >= 0 {
		t.Fatalf("ran a non-executable setup: %v", f.calls)
	}
}

func TestUnknownPlatformIsRefused(t *testing.T) {
	f, c := setup(t, "freebsd")
	if err := Run(f, c); err == nil || !strings.Contains(err.Error(), "freebsd") {
		t.Fatalf("err = %v", err)
	}
}

func TestLinuxSaysWhenTheUserIsNotInTheDockerGroup(t *testing.T) {
	var warned []string
	f, c := setup(t, "linux")
	f.have["docker"] = true
	f.outputs["id -nG"] = "esh2n wheel video"
	c.Warn = func(s string) { warned = append(warned, s) }
	dockerGroup(f, c)
	if len(warned) != 1 || !strings.Contains(warned[0], "omarchy-setup-security-sudoless-docker") {
		t.Fatalf("warned %q", warned)
	}
	warned = nil
	f.outputs["id -nG"] = "esh2n wheel docker"
	dockerGroup(f, c)
	if len(warned) != 0 {
		t.Fatalf("a member is not warned: %q", warned)
	}
	for _, call := range f.calls {
		if strings.Contains(call, "sudo") || strings.Contains(call, "omarchy-setup") {
			t.Fatalf("it must only say, never run: %v", f.calls)
		}
	}
}

func TestNixConfigKeepsWhatTheCallerHas(t *testing.T) {
	if got := nixConfig(""); got != "extra-experimental-features = nix-command flakes" {
		t.Fatalf("empty: %q", got)
	}
	if got := nixConfig("max-jobs = 4\n"); got != "max-jobs = 4\nextra-experimental-features = nix-command flakes" {
		t.Fatalf("kept: %q", got)
	}
}

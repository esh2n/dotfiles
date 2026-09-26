// Package up is `make up` after Nix exists: install and update alike, safe
// to run again (plans/2026-09-24-dotfiles-architecture.md §4). bootstrap.sh
// installs Nix when missing and hands over to `dotctl up`.
//
// The platform decides what runs, never the hostname or user name. Everything
// is evaluated and built as the user (lib/facts.nix reads the user's
// HOME, USER and roles file); only the macOS system activation runs as root.
package up

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Sys is the machine: commands and what is installed. Tests replace it.
type Sys interface {
	// Run runs a command in the foreground. An env entry "K=v" sets K; "K="
	// removes K from the environment.
	Run(env []string, name string, args ...string) error
	Output(name string, args ...string) (string, error)
	// Quiet runs a command with no output: a yes/no probe.
	Quiet(name string, args ...string) error
	Has(name string) bool
	OS() string     // "darwin" or "linux"
	Shells() string // the contents of /etc/shells
}

// Config is this checkout and this user.
type Config struct {
	Home, Repo string
	User       string // for nix-darwin's /etc/profiles/per-user/<user>
	Shell      string // the login shell ($SHELL)
	ZshPath    string // zsh; empty: FindZsh after the switch
	FindZsh    func() string
	RolesFile  string // default ~/.config/dotfiles/roles.json
	EtcDir     string // default /etc
	GPUUnit    string // default /etc/systemd/system/non-nixos-gpu.service
	Log, Warn  func(string)
}

var nix = []string{"nix", "--extra-experimental-features", "nix-command flakes"}

func (c Config) log(format string, a ...any) {
	if c.Log != nil {
		c.Log(fmt.Sprintf(format, a...))
	}
}

func (c Config) warn(format string, a ...any) {
	if c.Warn != nil {
		c.Warn(fmt.Sprintf(format, a...))
	}
}

// flake is where the flake lives: the checkout's root.
func (c Config) flake() string { return c.Repo }

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func nixCmd(s Sys, args ...string) error {
	return s.Run(nil, nix[0], append(nix[1:], args...)...)
}

// Run brings this machine to the checkout.
func Run(s Sys, c Config) error {
	switch s.OS() {
	case "darwin", "linux":
	default:
		return fmt.Errorf("unsupported platform: %s (macOS and Linux only)", s.OS())
	}
	if err := requireRoles(c); err != nil {
		return err
	}
	warnUntracked(s, c)
	sweepPriorLinks(c)
	if s.OS() == "darwin" {
		if err := switchDarwin(s, c); err != nil {
			return err
		}
	} else {
		if err := nixCmd(s, "run", c.flake()+"#home-manager", "--", "switch", "--flake", c.flake()+"#linux", "--impure", "-b", "pre-dotfiles"); err != nil {
			return fmt.Errorf("home-manager switch: %w", err)
		}
	}
	// A first switch installs tools into profiles this process has not got
	// on its PATH yet (a new login shell would).
	_ = os.Setenv("PATH", strings.Join([]string{
		filepath.Join("/etc/profiles/per-user", c.User, "bin"),
		filepath.Join(c.Home, ".nix-profile", "bin"),
		os.Getenv("PATH"),
	}, string(os.PathListSeparator)))
	if s.OS() == "linux" {
		gpuDrivers(s, c)
		dockerGroup(s, c)
	}
	loginShell(s, c)
	if !s.Has("mise") {
		c.warn("mise is not on PATH; language runtimes were not installed")
		return nil
	}
	return s.Run(nil, "mise", "install")
}

// Without the roles file only base would be installed, so a machine that
// had more would lose it: stop and say what to write instead.
func requireRoles(c Config) error {
	file := orDefault(c.RolesFile, filepath.Join(c.Home, ".config", "dotfiles", "roles.json"))
	if _, err := os.Stat(file); err == nil {
		return nil
	}
	return fmt.Errorf("no roles file at %s. Write the roles this machine takes, for example:\n"+
		"  mkdir -p %s && echo '{\"roles\": [\"developer\", \"desk-user\", \"model-provider\", \"observer\"]}' > %s\n"+
		"roles (every machine is base, unlisted): developer (writes code with coding agents), desk-user (GUI apps, fonts), model-provider (lends its local models on the tailnet: LM Studio on the Mac, llama-server on Linux + NVIDIA), observer (Prometheus, Grafana, the cost ledger, Open WebUI; one machine)",
		file, filepath.Dir(file), file)
}

// The flake is read through git: files git does not track are invisible.
func warnUntracked(s Sys, c Config) {
	out, err := s.Output("git", "-C", c.flake(), "ls-files", "--others", "--exclude-standard", "--", ".")
	if err != nil || strings.TrimSpace(out) == "" {
		return
	}
	c.warn("files in the checkout that git does not track are ignored by the flake (git add them):\n  %s",
		strings.ReplaceAll(strings.TrimSpace(out), "\n", "\n  "))
}

func switchDarwin(s Sys, c Config) error {
	if err := homebrew(s, c); err != nil {
		return err
	}
	trustTaps(s, c)
	if err := setAsideEtc(s, c); err != nil {
		return err
	}
	// What `darwin-rebuild switch` does, split so only the last two steps are
	// root's: under sudo darwin-rebuild resets HOME, and facts.nix would read
	// root's home.
	out, err := s.Output(nix[0], append(nix[1:], "build", "--no-link", "--print-out-paths", "--impure", c.flake()+"#darwinConfigurations.mac.system")...)
	if err != nil {
		return fmt.Errorf("building the system: %w", err)
	}
	system := strings.TrimSpace(out)
	if system == "" {
		return errors.New("building the system printed no store path")
	}
	if err := s.Run(nil, "sudo", "-H", system+"/sw/bin/nix-env", "-p", "/nix/var/nix/profiles/system", "--set", system); err != nil {
		return fmt.Errorf("setting the system profile: %w", err)
	}
	if err := s.Run(nil, "sudo", "-H", system+"/activate"); err != nil {
		return fmt.Errorf("activating: %w", err)
	}
	return nil
}

// nix-darwin drives Homebrew but does not install it.
func homebrew(s Sys, c Config) error {
	if s.Has("brew") {
		return nil
	}
	c.log("installing Homebrew")
	script, err := s.Output("curl", "-fsSL", "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh")
	if err != nil {
		return fmt.Errorf("downloading the Homebrew installer: %w", err)
	}
	if err := s.Run(nil, "/bin/bash", "-c", script); err != nil {
		return fmt.Errorf("installing Homebrew: %w", err)
	}
	if s.Has("brew") {
		return nil
	}
	for _, dir := range []string{"/opt/homebrew/bin", "/usr/local/bin"} {
		if _, err := os.Stat(filepath.Join(dir, "brew")); err == nil {
			return os.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
		}
	}
	return errors.New("brew is not found after installing Homebrew; open a new shell and run make up again")
}

// tapsExpr lists the third-party taps the flake names (taps, and the tap of
// each tap-qualified formula or cask).
const tapsExpr = `h: let
  tapOf = n: let p = builtins.filter builtins.isString (builtins.split "/" n); in
    if builtins.length p >= 3 then "${builtins.elemAt p 0}/${builtins.elemAt p 1}" else null;
  names = map (t: t.name) h.taps ++ builtins.filter (x: x != null) (map (x: tapOf x.name) (h.brews ++ h.casks));
  third = builtins.filter (n: builtins.substring 0 9 n != "homebrew/") names;
in builtins.concatStringsSep " " (builtins.attrNames (builtins.listToAttrs (map (n: { name = n; value = null; }) third)))`

// Homebrew refuses third-party taps it was not told to trust, and nix-darwin
// runs brew with a scrubbed environment: trust in both config homes.
func trustTaps(s Sys, c Config) {
	if s.Quiet("brew", "trust", "--help") != nil {
		return
	}
	out, err := s.Output(nix[0], append(nix[1:], "eval", "--impure", "--raw", c.flake()+"#darwinConfigurations.mac.config.homebrew", "--apply", tapsExpr)...)
	taps := strings.Fields(out)
	if err != nil || len(taps) == 0 {
		return
	}
	args := append([]string{"trust", "--tap"}, taps...)
	if err := s.Run(nil, "brew", args...); err != nil {
		c.warn("brew trust failed")
	}
	if err := s.Run([]string{"XDG_CONFIG_HOME="}, "brew", args...); err != nil {
		c.warn("brew trust (without XDG_CONFIG_HOME) failed")
	}
}

// On a Mac nix-darwin has never managed, /etc/bashrc and /etc/zshrc are plain
// files and activation refuses to replace them: move them aside once.
func setAsideEtc(s Sys, c Config) error {
	etc := orDefault(c.EtcDir, "/etc")
	for _, f := range []string{"bashrc", "zshrc"} {
		p := filepath.Join(etc, f)
		info, err := os.Lstat(p)
		if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			continue
		}
		if _, err := os.Lstat(p + ".before-nix-darwin"); err == nil {
			continue
		}
		// activation would refuse the plain file anyway: stop here, clearly
		if err := s.Run(nil, "sudo", "mv", p, p+".before-nix-darwin"); err != nil {
			return fmt.Errorf("moving %s aside (nix-darwin will not replace it): %w", p, err)
		}
	}
	return nil
}

// The gpu role's CUDA programs find the NVIDIA libraries through
// /run/opengl-driver, provided by a system service installed as root.
func gpuDrivers(s Sys, c Config) {
	setup := filepath.Join(c.Home, ".nix-profile", "bin", "non-nixos-gpu-setup")
	real, err := filepath.EvalSymlinks(setup)
	if err != nil {
		return
	}
	if info, err := os.Stat(real); err != nil || info.Mode()&0o111 == 0 {
		return // not an executable yet: nothing to run
	}
	want := filepath.Join(filepath.Dir(filepath.Dir(real)), "lib", "systemd", "system", "non-nixos-gpu.service")
	unit, _ := filepath.EvalSymlinks(orDefault(c.GPUUnit, "/etc/systemd/system/non-nixos-gpu.service"))
	if unit == want {
		return
	}
	c.log("setting up NVIDIA drivers for Nix programs (root)")
	if err := s.Run(nil, "sudo", setup); err != nil {
		c.warn("non-nixos-gpu-setup failed; CUDA programs will not find the GPU")
	}
}

// The login shell is zsh. chsh accepts only listed shells, and on Linux only
// root may list one: then say what to do instead.
func loginShell(s Sys, c Config) {
	if c.ZshPath == "" && c.FindZsh != nil {
		c.ZshPath = c.FindZsh()
	}
	if strings.HasSuffix(c.Shell, "/zsh") || c.ZshPath == "" {
		return
	}
	for _, line := range strings.Split(s.Shells(), "\n") {
		if strings.TrimSpace(line) == c.ZshPath {
			if err := s.Run(nil, "chsh", "-s", c.ZshPath); err != nil {
				c.warn("chsh -s %s failed; the login shell is unchanged", c.ZshPath)
			}
			return
		}
	}
	c.warn("%s is not in /etc/shells; add it (sudo) and run: chsh -s %s", c.ZshPath, c.ZshPath)
}

// Omarchy installs Docker but, since 4.x, leaves the user out of the docker
// group ("equivalent to passwordless root"); LiteLLM and the observer's
// stacks run docker as the user, so without it they cannot start. Joining is
// Omarchy's own command and asks for sudo: said, never done here.
func dockerGroup(s Sys, c Config) {
	if !s.Has("docker") {
		return
	}
	groups, err := s.Output("id", "-nG")
	if err != nil {
		return
	}
	for _, g := range strings.Fields(groups) {
		if g == "docker" {
			return
		}
	}
	c.warn("you are not in the docker group, so LiteLLM cannot run its containers: run omarchy-setup-security-sudoless-docker (it asks for sudo), then log in again")
}

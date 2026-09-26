package mado

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

type fakeSys struct {
	running  map[string]bool // processes
	services map[string]bool // brew services
	calls    []string
	aero     map[string]string // aerospace args -> output
}

func (f *fakeSys) Shell(cmd string) error {
	f.calls = append(f.calls, "sh "+cmd)
	if strings.HasPrefix(cmd, "open -a ") {
		f.running[strings.TrimPrefix(cmd, "open -a ")] = true
	}
	return nil
}
func (f *fakeSys) Running(proc string) bool            { return f.running[proc] }
func (f *fakeSys) RunningMatching(pattern string) bool { return f.running[pattern] }
func (f *fakeSys) Kill(proc string) {
	f.calls = append(f.calls, "pkill "+proc)
	f.running[proc] = false
}
func (f *fakeSys) ServiceRunning(svc string) bool { return f.services[svc] }
func (f *fakeSys) Service(action, svc string) error {
	f.calls = append(f.calls, "brew services "+action+" "+svc)
	f.services[svc] = action == "start"
	return nil
}
func (f *fakeSys) Sleep(float64) {}
func (f *fakeSys) Aerospace(args ...string) (string, error) {
	f.calls = append(f.calls, "aerospace "+strings.Join(args, " "))
	return f.aero[strings.Join(args, " ")], nil
}
func (f *fakeSys) Has(string) bool { return true }

func world(t *testing.T) (*fakeSys, Config, *bytes.Buffer) {
	t.Helper()
	dir := t.TempDir()
	profiles := filepath.Join(dir, "profiles")
	must(t, os.MkdirAll(profiles, 0o755))
	write := func(name, body string) {
		must(t, os.WriteFile(filepath.Join(profiles, name+".profile"), []byte(body), 0o644))
	}
	write("loop", "# Loop — default\nWM_NAME=\"Loop\"\nWM_START=\"open -a Loop\"\nWM_PGREP=\"Loop\"\nSERVICES_ON=(sketchybar borders)\nSERVICES_OFF=()\n")
	write("omniwm", "WM_NAME=\"OmniWM\"\nWM_START=\"open -a OmniWM\"\nWM_PGREP=\"OmniWM\"\nSERVICES_ON=()\nSERVICES_OFF=(sketchybar borders)\n")
	write("none", "WM_NAME=\"\"\nWM_START=\"\"\nWM_PGREP=\"\"\nSERVICES_ON=(sketchybar)\nSERVICES_OFF=(borders)\n")
	out := &bytes.Buffer{}
	f := &fakeSys{running: map[string]bool{}, services: map[string]bool{}, aero: map[string]string{}}
	return f, Config{ProfileDir: profiles, StateDir: filepath.Join(dir, "state"), LayoutDir: filepath.Join(dir, "layouts"), Out: out, In: strings.NewReader("")}, out
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	must(t, err)
	return string(b)
}

func TestParseProfile(t *testing.T) {
	p, err := parseProfile("# c\nWM_NAME=\"Paneru\"\nWM_START=\"nohup paneru >/dev/null 2>&1 &\"\nWM_PGREP=\"paneru\"\nSERVICES_ON=(sketchybar borders)\nSERVICES_OFF=()\n")
	must(t, err)
	if p.Name != "Paneru" || p.Start != "nohup paneru >/dev/null 2>&1 &" || p.Pgrep != "paneru" ||
		!slices.Equal(p.On, []string{"sketchybar", "borders"}) || len(p.Off) != 0 {
		t.Fatalf("%+v", p)
	}
}

func TestUseStopsOtherWMsSyncsServicesStartsAndRecords(t *testing.T) {
	f, c, _ := world(t)
	f.running["AeroSpace"] = true
	f.services["borders"] = true
	must(t, Use(f, c, "omniwm"))
	if !slices.Contains(f.calls, "pkill AeroSpace") {
		t.Fatalf("old WM not stopped: %v", f.calls)
	}
	if !slices.Contains(f.calls, "brew services stop borders") || slices.Contains(f.calls, "brew services stop sketchybar") {
		t.Fatalf("services: %v", f.calls)
	}
	if !slices.Contains(f.calls, "sh open -a OmniWM") {
		t.Fatalf("not started: %v", f.calls)
	}
	if got := read(t, filepath.Join(c.StateDir, "profile")); got != "omniwm\n" {
		t.Fatalf("profile state %q", got)
	}
	if got := read(t, filepath.Join(c.StateDir, "services")); got != "\n" {
		t.Fatalf("services state %q (hammerspoon reads one per line)", got)
	}
}

func TestUseWithNoNameReappliesTheRecordedOneOrTheDefault(t *testing.T) {
	f, c, _ := world(t)
	must(t, Use(f, c, ""))
	if got := read(t, filepath.Join(c.StateDir, "profile")); got != "loop\n" {
		t.Fatalf("default: %q", got)
	}
	if got := read(t, filepath.Join(c.StateDir, "services")); got != "sketchybar\nborders\n" {
		t.Fatalf("services state %q", got)
	}
	must(t, Use(f, c, "none"))
	must(t, Use(f, c, ""))
	if got := read(t, filepath.Join(c.StateDir, "profile")); got != "none\n" {
		t.Fatalf("recorded: %q", got)
	}
}

func TestUnknownProfileIsRefused(t *testing.T) {
	f, c, _ := world(t)
	if err := Use(f, c, "i3"); err == nil || !strings.Contains(err.Error(), "i3") {
		t.Fatalf("err = %v", err)
	}
}

func TestDryRunChangesNothing(t *testing.T) {
	f, c, out := world(t)
	c.DryRun = true
	f.running["AeroSpace"] = true
	must(t, Use(f, c, "loop"))
	if len(f.calls) != 0 || !strings.Contains(out.String(), "[dry-run]") {
		t.Fatalf("calls %v out %q", f.calls, out.String())
	}
	if _, err := os.Stat(filepath.Join(c.StateDir, "profile")); err == nil {
		t.Fatal("dry run recorded state")
	}
}

func TestStopStopsEverythingAndRecordsStopped(t *testing.T) {
	f, c, _ := world(t)
	f.running["Loop"] = true
	f.services["sketchybar"] = true
	must(t, Stop(f, c))
	if !slices.Contains(f.calls, "pkill Loop") || !slices.Contains(f.calls, "brew services stop sketchybar") {
		t.Fatalf("%v", f.calls)
	}
	if got := read(t, filepath.Join(c.StateDir, "profile")); got != "stopped\n" {
		t.Fatalf("%q", got)
	}
}

func TestStatusReportsDrift(t *testing.T) {
	f, c, out := world(t)
	must(t, Use(f, c, "loop"))
	f.running["Loop"] = false
	must(t, Status(f, c))
	if !strings.Contains(out.String(), "State drift") {
		t.Fatalf("%q", out.String())
	}
}

func TestListMarksTheCurrentProfile(t *testing.T) {
	f, c, out := world(t)
	must(t, Use(f, c, "omniwm"))
	out.Reset()
	must(t, List(c))
	if !strings.Contains(out.String(), "* omniwm (current)") || !strings.Contains(out.String(), "  loop\n") {
		t.Fatalf("%q", out.String())
	}
}

func TestLayoutSaveWritesTheOldJSONShape(t *testing.T) {
	f, c, _ := world(t)
	c.In = strings.NewReader("work\n")
	f.aero["list-workspaces --focused"] = "C\n"
	f.aero["list-windows --workspace focused --format %{window-id}|%{app-name}|%{window-title}"] = "12 | Slack | general\n"
	f.aero["list-apps"] = "123 com.tinyspeck.slackmacgap Slack\n"
	must(t, os.MkdirAll(c.LayoutDir, 0o755))
	must(t, LayoutSave(f, c))
	got := read(t, filepath.Join(c.LayoutDir, "work.json"))
	for _, want := range []string{`"name": "work"`, `"workspace": "C"`, `"app_id": "com.tinyspeck.slackmacgap"`, `"window_id": "12"`} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %s in %s", want, got)
		}
	}
}

func TestMenusEndWhenInputCloses(t *testing.T) {
	f, c, out := world(t)
	c.In = strings.NewReader("9\n2\n")
	MainMenu(f, c.Interactive())
	if !strings.Contains(out.String(), "invalid option") || !strings.Contains(out.String(), "recorded profile") {
		t.Fatalf("%q", out.String())
	}
}

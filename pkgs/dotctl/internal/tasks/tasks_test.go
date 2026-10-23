package tasks

import (
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// fakeSys records calls; sqlite3 writes the backup file it is asked for, and
// task reads the rc file named in TASKRC.
type fakeSys struct {
	syncFail, backupFail bool
	calls                []sys.Cmd
	rc                   string
	rcMode               os.FileMode
}

func (f *fakeSys) Exec(c sys.Cmd) (string, string, error) {
	f.calls = append(f.calls, c)
	if c.Name == "sqlite3" {
		if f.backupFail {
			return "", "database is locked", errors.New("exit status 1")
		}
		dest := strings.TrimSuffix(strings.TrimPrefix(c.Args[1], ".backup '"), "'")
		return "", "", os.WriteFile(dest, []byte("db"), 0o600)
	}
	name := strings.TrimPrefix(c.Env[0], "TASKRC=")
	b, _ := os.ReadFile(name)
	f.rc = string(b)
	if info, err := os.Stat(name); err == nil {
		f.rcMode = info.Mode().Perm()
	}
	if f.syncFail {
		return "", "Failed to synchronize with server", errors.New("exit status 1")
	}
	return "", "", nil
}

var day = time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)

func config(t *testing.T, env map[string]string) Config {
	t.Helper()
	base := map[string]string{
		"TASK_SYNC_URL": "https://mac.example.ts.net:10222", "TASK_CLIENT_ID": "id-1", "TASK_ENCRYPTION_SECRET": "s3cr+t/==",
		"TASK_DATA": filepath.Join(t.TempDir(), "data"), "TASK_STATE_DIR": filepath.Join(t.TempDir(), "state"),
	}
	for k, v := range env {
		base[k] = v
	}
	c, err := FromEnv(func(k string) string { return base[k] }, "/home/x")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func replica(t *testing.T, c Config) {
	t.Helper()
	if err := os.MkdirAll(c.Data, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(c.Data, "taskchampion.sqlite3"), []byte("db"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestSyncsThroughAPrivateRcThatIncludesTheOwnersTaskrc(t *testing.T) {
	c := config(t, nil)
	f := &fakeSys{}
	if err := Once(f, ui.Printer{}, c, day); err != nil {
		t.Fatal(err)
	}
	if len(f.calls) != 1 || f.calls[0].Name != "task" || strings.Join(f.calls[0].Args, " ") != "rc.confirmation=no rc.verbose=nothing sync" {
		t.Fatalf("calls %v", f.calls)
	}
	want := "include /home/x/.config/task/taskrc\nsync.server.url=https://mac.example.ts.net:10222\nsync.server.client_id=id-1\nsync.encryption_secret=s3cr+t/==\n"
	if f.rc != want {
		t.Fatalf("rc %q", f.rc)
	}
	for _, a := range f.calls[0].Args {
		if strings.Contains(a, "s3cr") {
			t.Fatal("the secret is on the command line")
		}
	}
	if f.rcMode != 0o600 {
		t.Fatalf("rc mode while task ran: %v", f.rcMode)
	}
	if _, err := os.Stat(filepath.Join(c.StateDir, "sync.rc")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("the rc with the secret outlived the run: %v", err)
	}
	for _, want := range []string{"TASK_CLIENT_ID=", "TASK_ENCRYPTION_SECRET=", "OP_SERVICE_ACCOUNT_TOKEN="} {
		if !slices.Contains(f.calls[0].Env, want) {
			t.Fatalf("task inherits %s: %v", want, f.calls[0].Env)
		}
	}
}

func TestAnExistingRcIsMadePrivateAgain(t *testing.T) {
	c := config(t, nil)
	if err := os.MkdirAll(c.StateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	rc := filepath.Join(c.StateDir, "sync.rc")
	if err := os.WriteFile(rc, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	f := &fakeSys{}
	if err := Once(f, ui.Printer{}, c, day); err != nil {
		t.Fatal(err)
	}
	if f.rcMode != 0o600 {
		t.Fatalf("mode %v", f.rcMode)
	}
}

func TestAFailedSyncIsReportedAndTheBackupStillMade(t *testing.T) {
	c := config(t, nil)
	replica(t, c)
	f := &fakeSys{syncFail: true}
	err := Once(f, ui.Printer{}, c, day)
	if err == nil || !strings.Contains(err.Error(), "changes go next time") || !strings.Contains(err.Error(), "Failed to synchronize") {
		t.Fatalf("got %v", err)
	}
	if _, err := os.Stat(filepath.Join(c.StateDir, "backups", "2026-10-23.sqlite3")); err != nil {
		t.Fatal("no backup", err)
	}
	if _, err := os.Stat(filepath.Join(c.StateDir, "sync.rc")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("a failed run left the rc: %v", err)
	}
}

func TestNoServerKeepsTheReplicaLocal(t *testing.T) {
	c := config(t, map[string]string{"TASK_SYNC_URL": "", "TASK_CLIENT_ID": "", "TASK_ENCRYPTION_SECRET": ""})
	f := &fakeSys{}
	var out bytes.Buffer
	if err := Once(f, ui.Printer{Out: &out}, c, day); err != nil || len(f.calls) != 0 || !strings.Contains(out.String(), "stays local") {
		t.Fatalf("%v %v %q", err, f.calls, out.String())
	}
	if _, err := os.Stat(filepath.Join(c.StateDir, "sync.rc")); err == nil {
		t.Fatal("wrote an rc with no server")
	}
}

func TestBadInputsAreRefused(t *testing.T) {
	cases := []map[string]string{
		{"TASK_CLIENT_ID": ""},
		{"TASK_ENCRYPTION_SECRET": ""},
		{"TASK_ENCRYPTION_SECRET": "a\nsync.server.url=http://evil"},
		{"TASK_SYNC_URL": "https://h:10222\nsync.encryption_secret=x"},
		{"TASK_CLIENT_ID": "id\nx=y"},
		{"TASK_TASKRC": "/rc\nsync.server.url=http://evil"},
		{"TASK_KEEP_DAYS": "0"},
		{"TASK_KEEP_DAYS": "week"},
		{"TASK_KEEP_DAYS": "3x"},
	}
	for _, env := range cases {
		base := map[string]string{"TASK_SYNC_URL": "https://h:10222", "TASK_CLIENT_ID": "id", "TASK_ENCRYPTION_SECRET": "s"}
		for k, v := range env {
			base[k] = v
		}
		if _, err := FromEnv(func(k string) string { return base[k] }, "/home/x"); err == nil {
			t.Errorf("%v accepted", env)
		}
	}
}

func TestBacksUpOnceADayAndKeepsTheNewest(t *testing.T) {
	c := config(t, map[string]string{"TASK_KEEP_DAYS": "3", "TASK_SYNC_URL": "", "TASK_CLIENT_ID": "", "TASK_ENCRYPTION_SECRET": ""})
	replica(t, c)
	f := &fakeSys{}
	for i := 0; i < 5; i++ {
		d := day.AddDate(0, 0, i)
		for j := 0; j < 2; j++ { // a second run the same day copies nothing
			if err := Once(f, ui.Printer{}, c, d); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(f.calls) != 5 {
		t.Fatalf("%d backups run, want one a day", len(f.calls))
	}
	names, _ := filepath.Glob(filepath.Join(c.StateDir, "backups", "*.sqlite3"))
	var got []string
	for _, n := range names {
		got = append(got, filepath.Base(n))
	}
	if strings.Join(got, " ") != "2026-10-25.sqlite3 2026-10-26.sqlite3 2026-10-27.sqlite3" {
		t.Fatalf("kept %v", got)
	}
	if a := f.calls[0].Args; a[0] != filepath.Join(c.Data, "taskchampion.sqlite3") || !strings.HasPrefix(a[1], ".backup '") {
		t.Fatalf("backup call %v", a)
	}
}

func TestAFailedBackupLeavesNoPartialCopyAndTriesAgain(t *testing.T) {
	c := config(t, nil)
	replica(t, c)
	f := &fakeSys{backupFail: true}
	if err := Once(f, ui.Printer{}, c, day); err == nil || !strings.Contains(err.Error(), "database is locked") {
		t.Fatalf("got %v", err)
	}
	if len(f.calls) != 2 || f.calls[1].Name != "task" {
		t.Fatalf("a failed backup stopped the sync: %v", f.calls)
	}
	f.backupFail = false
	if err := Once(f, ui.Printer{}, c, day); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(c.StateDir, "backups", "2026-10-23.sqlite3")); err != nil {
		t.Fatal("not retried", err)
	}
}

func TestNoReplicaYetIsNoBackup(t *testing.T) {
	c := config(t, nil)
	f := &fakeSys{}
	if err := Once(f, ui.Printer{}, c, day); err != nil || len(f.calls) != 1 {
		t.Fatalf("%v %v", err, f.calls)
	}
}

func TestDefaultsAndTheBinariesNixNames(t *testing.T) {
	c, err := FromEnv(func(string) string { return "" }, "/home/x")
	if err != nil {
		t.Fatal(err)
	}
	want := Config{Taskrc: "/home/x/.config/task/taskrc", Data: "/home/x/.task", StateDir: "/home/x/.local/state/task-sync", Task: "task", SQLite: "sqlite3", KeepDays: 7}
	if c != want {
		t.Fatalf("defaults %+v", c)
	}
	c = config(t, map[string]string{"TASK_BIN": "/nix/task", "TASK_SQLITE": "/nix/sqlite3"})
	replica(t, c)
	f := &fakeSys{}
	_ = Once(f, ui.Printer{}, c, day)
	if len(f.calls) != 2 || f.calls[0].Name != "/nix/sqlite3" || f.calls[1].Name != "/nix/task" {
		t.Fatalf("calls %v", f.calls)
	}
}

func TestAStateDirWithAQuoteIsRefusedBeforeSQLiteRuns(t *testing.T) {
	c := config(t, map[string]string{"TASK_SYNC_URL": "", "TASK_CLIENT_ID": "", "TASK_ENCRYPTION_SECRET": ""})
	c.StateDir = filepath.Join(t.TempDir(), "it's")
	replica(t, c)
	f := &fakeSys{}
	if err := Once(f, ui.Printer{}, c, day); err == nil || len(f.calls) != 0 {
		t.Fatalf("%v %v", err, f.calls)
	}
}

func TestAKilledBackupDoesNotPassForTheDays(t *testing.T) {
	c := config(t, map[string]string{"TASK_SYNC_URL": "", "TASK_CLIENT_ID": "", "TASK_ENCRYPTION_SECRET": ""})
	replica(t, c)
	dir := filepath.Join(c.StateDir, "backups")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "2026-10-23.sqlite3.tmp"), []byte("half"), 0o600); err != nil {
		t.Fatal(err)
	}
	f := &fakeSys{}
	if err := Once(f, ui.Printer{}, c, day); err != nil || len(f.calls) != 1 {
		t.Fatalf("%v %v", err, f.calls)
	}
	if _, err := os.Stat(filepath.Join(dir, "2026-10-23.sqlite3")); err != nil {
		t.Fatal(err)
	}
}

// Loop keeps going after failures, sleeps the interval each time, and asks
// the time anew each run so the daily backup rolls over.
func TestLoopSurvivesFailuresAndRollsTheDay(t *testing.T) {
	c := config(t, nil)
	replica(t, c)
	f := &fakeSys{syncFail: true}
	runs := 0
	var slept []time.Duration
	func() {
		defer func() {
			if r := recover(); r != "stop" {
				panic(r)
			}
		}()
		Loop(f, ui.Printer{}, c, 5*time.Minute,
			func() time.Time { runs++; return day.AddDate(0, 0, runs) },
			func(d time.Duration) {
				slept = append(slept, d)
				if len(slept) == 3 {
					panic("stop")
				}
			})
	}()
	syncs := 0
	for _, call := range f.calls {
		if call.Name == "task" {
			syncs++
		}
	}
	if syncs != 3 || len(slept) != 3 || slept[0] != 5*time.Minute || slept[2] != 5*time.Minute {
		t.Fatalf("syncs %d, slept %v", syncs, slept)
	}
	names, _ := filepath.Glob(filepath.Join(c.StateDir, "backups", "*.sqlite3"))
	if len(names) != 3 {
		t.Fatalf("backups %v", names)
	}
}

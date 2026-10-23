// Package tasks syncs this machine's Taskwarrior replica with the one
// taskchampion-sync-server on the observer machine, and keeps a daily copy of
// the replica (rules/decisions/2026-10-23-personal-tasks-sync.md).
//
// Taskwarrior has no sync of its own accord: something has to run `task sync`.
// Each run writes a private rc file that includes the owner's taskrc and adds
// the sync settings, so the client id and the encryption secret never sit in
// the taskrc the owner reads and never reach a command line. While the server
// is unreachable nothing is lost: the replica keeps its changes and the next
// run sends them.
package tasks

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// Sys runs task and sqlite3. sys.OS is the real one.
type Sys interface {
	Exec(c sys.Cmd) (string, string, error)
}

// Config is the environment the service gives the sync:
//
//	TASK_SYNC_URL          the sync server (unset: nothing to do)
//	TASK_CLIENT_ID         the replicas' shared client id (required with a URL)
//	TASK_ENCRYPTION_SECRET the replicas' shared secret (required with a URL)
//	TASK_TASKRC            the owner's taskrc (default ~/.config/task/taskrc)
//	TASK_DATA              the replica's directory (default ~/.task)
//	TASK_STATE_DIR         the private rc and the backups (default ~/.local/state/task-sync)
//	TASK_KEEP_DAYS         daily backups kept (default 7)
//	TASK_BIN, TASK_SQLITE  the task and sqlite3 to run (default: on PATH; the service names Nix's)
type Config struct {
	URL, ClientID, Secret, Taskrc, Data, StateDir, Task, SQLite string
	KeepDays                                                    int
}

// FromEnv reads Config from the environment, with the defaults above.
func FromEnv(getenv func(string) string, home string) (Config, error) {
	c := Config{
		URL: getenv("TASK_SYNC_URL"), ClientID: getenv("TASK_CLIENT_ID"), Secret: getenv("TASK_ENCRYPTION_SECRET"),
		Taskrc: getenv("TASK_TASKRC"), Data: getenv("TASK_DATA"), StateDir: getenv("TASK_STATE_DIR"),
		Task: getenv("TASK_BIN"), SQLite: getenv("TASK_SQLITE"), KeepDays: 7,
	}
	if c.Taskrc == "" {
		c.Taskrc = filepath.Join(home, ".config", "task", "taskrc")
	}
	if c.Data == "" {
		c.Data = filepath.Join(home, ".task")
	}
	if c.StateDir == "" {
		c.StateDir = filepath.Join(home, ".local", "state", "task-sync")
	}
	if c.Task == "" {
		c.Task = "task"
	}
	if c.SQLite == "" {
		c.SQLite = "sqlite3"
	}
	if s := getenv("TASK_KEEP_DAYS"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 {
			return c, fmt.Errorf("TASK_KEEP_DAYS must be a positive number of days, not %q", s)
		}
		c.KeepDays = n
	}
	if c.URL != "" && (c.ClientID == "" || c.Secret == "") {
		return c, errors.New("a sync server needs the client id and the encryption secret (TASK_CLIENT_ID, TASK_ENCRYPTION_SECRET)")
	}
	for _, v := range []string{c.URL, c.ClientID, c.Secret, c.Taskrc} {
		if strings.ContainsAny(v, "\n\r") {
			return c, errors.New("the sync settings must be one line each")
		}
	}
	return c, nil
}

// Once backs the replica up (at most once a day) and runs one sync. A nil
// error with no server is normal: the machine keeps its own replica.
func Once(s Sys, p ui.Printer, c Config, now time.Time) error {
	if err := os.MkdirAll(c.StateDir, 0o700); err != nil {
		return err
	}
	backupErr := backup(s, p, c, now)
	if c.URL == "" {
		p.Note("no sync server (the observer machine's tailnet name) — this replica stays local")
		return backupErr
	}
	rc := filepath.Join(c.StateDir, "sync.rc")
	body := fmt.Sprintf("include %s\nsync.server.url=%s\nsync.server.client_id=%s\nsync.encryption_secret=%s\n",
		c.Taskrc, c.URL, c.ClientID, c.Secret)
	// the secret is on disk only while task runs; a file left by a killed run
	// is replaced (WriteFile keeps an existing file's mode, hence the Chmod)
	defer os.Remove(rc)
	if err := os.WriteFile(rc, []byte(body), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(rc, 0o600); err != nil {
		return err
	}
	_, errOut, err := s.Exec(sys.Cmd{
		Name:    c.Task,
		Args:    []string{"rc.confirmation=no", "rc.verbose=nothing", "sync"},
		Env:     append([]string{"TASKRC=" + rc}, noSecrets...),
		Timeout: 2 * time.Minute,
	})
	if err != nil {
		return errors.Join(backupErr, fmt.Errorf("task sync failed (the server is unreachable or refused; changes go next time): %s", strings.TrimSpace(errOut)))
	}
	return backupErr
}

// noSecrets keeps the service's secrets out of task's environment, and so
// out of any Taskwarrior hook it runs; the rc file carries what task needs.
var noSecrets = []string{"TASK_CLIENT_ID=", "TASK_ENCRYPTION_SECRET=", "OP_SERVICE_ACCOUNT_TOKEN="}

// backup copies the replica into backups/<date>.sqlite3 through SQLite's own
// online backup, which is consistent while task writes, then drops all but
// the newest KeepDays copies.
func backup(s Sys, p ui.Printer, c Config, now time.Time) error {
	db := filepath.Join(c.Data, "taskchampion.sqlite3")
	if _, err := os.Stat(db); err != nil {
		return nil // no replica yet
	}
	dir := filepath.Join(c.StateDir, "backups")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	dest := filepath.Join(dir, now.Format("2006-01-02")+".sqlite3")
	if _, err := os.Stat(dest); err == nil {
		return nil
	}
	if strings.ContainsAny(dest, "'\n\\") {
		return errors.New("TASK_STATE_DIR must not contain quotes or backslashes")
	}
	// into a temporary name first: a run killed mid-copy leaves no file that
	// passes for the day's backup
	tmp := dest + ".tmp"
	if _, errOut, err := s.Exec(sys.Cmd{Name: c.SQLite, Args: []string{db, ".backup '" + tmp + "'"}, Env: noSecrets, Timeout: 2 * time.Minute}); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("could not back up the replica: %s", strings.TrimSpace(errOut))
	}
	if err := os.Rename(tmp, dest); err != nil {
		return err
	}
	p.Note("backed up the replica to %s", dest)
	names, err := filepath.Glob(filepath.Join(dir, "????-??-??.sqlite3"))
	if err != nil {
		return err
	}
	sort.Strings(names)
	for len(names) > c.KeepDays {
		if err := os.Remove(names[0]); err != nil {
			return err
		}
		names = names[1:]
	}
	return nil
}

// Loop runs Once every interval, forever; a failed run waits for the next.
func Loop(s Sys, p ui.Printer, c Config, interval time.Duration, now func() time.Time, sleep func(time.Duration)) {
	for {
		if err := Once(s, p, c, now()); err != nil {
			p.Warn("%v", err)
		}
		sleep(interval)
	}
}

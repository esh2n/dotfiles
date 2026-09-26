package ledger

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// fakePsql answers the newest-row query, writes rows for the \copy TO, and
// records the ledger session's script.
type fakePsql struct {
	rows        string
	newestFail  bool
	centralFail bool
	calls       []sys.Cmd
	script      string
}

func (f *fakePsql) Exec(c sys.Cmd) (string, string, error) {
	f.calls = append(f.calls, c)
	line := strings.Join(c.Args, " ")
	switch {
	case strings.Contains(line, " -At "):
		if f.newestFail {
			return "", "no route", errors.New("exit status 2")
		}
		return "2026-09-25 10:00:00\n", "", nil
	case strings.Contains(line, `\copy (SELECT`):
		file := line[strings.Index(line, " TO '")+5:]
		file = file[:strings.Index(file, "'")]
		return "", "", os.WriteFile(file, []byte(f.rows), 0o600)
	default:
		b, _ := io.ReadAll(c.Stdin)
		f.script = string(b)
		if f.centralFail {
			return "", "timeout", errors.New("exit status 2")
		}
		return "", "", nil
	}
}

func config(t *testing.T) Config {
	t.Helper()
	env := map[string]string{"LEDGER_PASSWORD": "pw", "LEDGER_SQL": "/repo/ledger.sql", "LEDGER_HOST": "mac.example.ts.net", "LEDGER_STATE_DIR": filepath.Join(t.TempDir(), "state")}
	c, err := FromEnv(func(k string) string { return env[k] }, "/home/x", "omarchy.local")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestShipsRowsOnceLabelledAndMovesTheWatermark(t *testing.T) {
	c := config(t)
	f := &fakePsql{rows: "row1\n"}
	var out bytes.Buffer
	if err := Once(f, ui.Printer{Out: &out, Err: &out}, c); err != nil {
		t.Fatal(err)
	}
	last := f.calls[len(f.calls)-1]
	if last.Name != "psql" || strings.Join(last.Args, " ") != "postgresql://litellm@mac.example.ts.net:5432/litellm -v ON_ERROR_STOP=1 -v machine=omarchy -q" {
		t.Fatalf("ledger call %v", last)
	}
	if last.Env[0] != "PGPASSWORD=pw" {
		t.Fatalf("env %v", last.Env)
	}
	for _, want := range []string{`\i /repo/ledger.sql`, "ON CONFLICT (request_id) DO NOTHING", "INSERT INTO ledger_origin SELECT request_id, :'machine'"} {
		if !strings.Contains(f.script, want) {
			t.Fatalf("script lacks %q:\n%s", want, f.script)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(c.StateDir, "shipped")); string(b) != "2026-09-25 10:00:00\n" {
		t.Fatalf("watermark %q", b)
	}
	if !strings.Contains(strings.Join(f.calls[1].Args, " "), "timestamp '1970-01-01 00:00:00' - interval '1 hour'") {
		t.Fatalf("first run does not start at the epoch: %v", f.calls[1].Args)
	}
}

func TestAFailedLedgerLeavesTheWatermark(t *testing.T) {
	c := config(t)
	if err := os.MkdirAll(c.StateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mark := filepath.Join(c.StateDir, "shipped")
	if err := os.WriteFile(mark, []byte("2026-09-24 09:00:00\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := &fakePsql{rows: "row1\n", centralFail: true}
	if err := Once(f, ui.Printer{}, c); err == nil || !strings.Contains(err.Error(), "sent next time") {
		t.Fatalf("got %v", err)
	}
	if b, _ := os.ReadFile(mark); string(b) != "2026-09-24 09:00:00\n" {
		t.Fatalf("watermark moved to %q", b)
	}
	if !strings.Contains(strings.Join(f.calls[1].Args, " "), "timestamp '2026-09-24 09:00:00' - interval '1 hour'") {
		t.Fatalf("did not resume from the watermark: %v", f.calls[1].Args)
	}
}

func TestNothingToDoAndBadInputs(t *testing.T) {
	c := config(t)
	f := &fakePsql{}
	if err := Once(f, ui.Printer{}, c); err != nil || len(f.calls) != 2 {
		t.Fatalf("no rows: %v %d calls", err, len(f.calls))
	}
	c.Central = ""
	var out bytes.Buffer
	if err := Once(f, ui.Printer{Out: &out}, c); err != nil || !strings.Contains(out.String(), "nothing to ship") {
		t.Fatalf("no host: %v %q", err, out.String())
	}
	c = config(t)
	if err := Once(&fakePsql{newestFail: true}, ui.Printer{}, c); err == nil {
		t.Fatal("an unanswering local DB is not an error")
	}
	_ = os.MkdirAll(c.StateDir, 0o755)
	_ = os.WriteFile(filepath.Join(c.StateDir, "shipped"), []byte("'; DROP TABLE x; --"), 0o644)
	f = &fakePsql{}
	var warn bytes.Buffer
	_ = Once(f, ui.Printer{Err: &warn}, c)
	if strings.Contains(strings.Join(f.calls[0].Args, " "), "DROP") || !strings.Contains(warn.String(), "not a timestamp") {
		t.Fatalf("a bad watermark reached SQL: %v", f.calls[0].Args)
	}
	c.SQL = "/x'y.sql"
	if err := Once(&fakePsql{}, ui.Printer{}, c); err == nil {
		t.Fatal("a quote in LEDGER_SQL accepted")
	}
	for _, missing := range []string{"LEDGER_PASSWORD", "LEDGER_SQL"} {
		env := map[string]string{"LEDGER_PASSWORD": "pw", "LEDGER_SQL": "/s"}
		delete(env, missing)
		if _, err := FromEnv(func(k string) string { return env[k] }, "/h", "m"); err == nil {
			t.Fatalf("no %s accepted", missing)
		}
	}
}

func TestLoopKeepsGoingAfterAFailure(t *testing.T) {
	c := config(t)
	runs := 0
	defer func() { _ = recover() }()
	Loop(&fakePsql{newestFail: true}, ui.Printer{}, c, time.Second, func(time.Duration) {
		runs++
		if runs == 2 {
			panic("stop")
		}
	})
}

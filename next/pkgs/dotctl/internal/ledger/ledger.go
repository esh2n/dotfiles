// Package ledger ships this machine's LiteLLM spend rows to the one cost
// ledger (rules/decisions/2026-09-25-llm-cost-ledger-local-first.md; was
// next/pkgs/scripts/llm-ledger-sync).
//
// It reads LiteLLM_SpendLogs from this machine's Postgres and inserts the
// rows into the ledger's, ON CONFLICT (request_id) DO NOTHING — request_id is
// the table's primary key, so a row sent twice stays one row. Each run sends
// everything from an hour before the last shipped row (the watermark, taken
// before copying), so rows written during a run go with the next one. While
// the ledger is unreachable nothing is lost: the rows stay in the local DB
// and the watermark does not move. Both DBs are created by the same pinned
// LiteLLM image, so the tables have the same columns in the same order.
package ledger

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/ui"
)

// Sys runs psql. sys.OS is the real one.
type Sys interface {
	Exec(c sys.Cmd) (string, string, error)
}

// Config is the environment the service gives the sync:
//
//	LEDGER_PASSWORD  both DBs' password (required)
//	LEDGER_SQL       the ledger's own tables (required)
//	LEDGER_HOST      the observer machine's tailnet name (unset: nothing to do)
//	LEDGER_MACHINE   this machine's name in the ledger (default: short hostname)
//	LEDGER_LOCAL     host:port/db of this machine's DB (default 127.0.0.1:5432/litellm)
//	LEDGER_CENTRAL   host:port/db of the ledger (default $LEDGER_HOST:5432/litellm)
//	LEDGER_STATE_DIR where the watermark lives (default ~/.local/state/llm-ledger)
//	LEDGER_PSQL      the psql to run (default psql on PATH; the service names Nix's)
type Config struct {
	Password, SQL, Host, Machine, Local, Central, StateDir, PSQL string
}

// FromEnv reads Config from the environment, with the defaults above.
func FromEnv(getenv func(string) string, home, hostname string) (Config, error) {
	c := Config{
		Password: getenv("LEDGER_PASSWORD"), SQL: getenv("LEDGER_SQL"), Host: getenv("LEDGER_HOST"),
		Machine: getenv("LEDGER_MACHINE"), Local: getenv("LEDGER_LOCAL"), Central: getenv("LEDGER_CENTRAL"),
		StateDir: getenv("LEDGER_STATE_DIR"), PSQL: getenv("LEDGER_PSQL"),
	}
	if c.PSQL == "" {
		c.PSQL = "psql"
	}
	if c.Password == "" {
		return c, errors.New("the ledger DB password is required (LEDGER_PASSWORD)")
	}
	if c.SQL == "" {
		return c, errors.New("the ledger tables are required (LEDGER_SQL: next/home/shared/llm-ledger/ledger.sql)")
	}
	if c.Machine == "" {
		c.Machine = strings.SplitN(hostname, ".", 2)[0]
	}
	if c.Local == "" {
		c.Local = "127.0.0.1:5432/litellm"
	}
	if c.Central == "" && c.Host != "" {
		c.Central = c.Host + ":5432/litellm"
	}
	if c.StateDir == "" {
		c.StateDir = filepath.Join(home, ".local", "state", "llm-ledger")
	}
	return c, nil
}

const epoch = "1970-01-01 00:00:00"

// the watermark goes into SQL: only a plain timestamp gets there
var timestamp = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?$`)

func (c Config) psql(s Sys, url, stdin string, args ...string) (string, string, error) {
	cmd := sys.Cmd{
		Name:    c.PSQL,
		Args:    append([]string{url}, args...),
		Env:     []string{"PGPASSWORD=" + c.Password, "PGCONNECT_TIMEOUT=10"},
		Timeout: 5 * time.Minute,
	}
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	return s.Exec(cmd)
}

// quotable is a path psql may take inside single quotes.
func quotable(p string) bool { return !strings.ContainsAny(p, "'\n\\") }

// Once runs one sync. A nil error with nothing shipped is normal (no host,
// no new rows); an error leaves the watermark where it was.
func Once(s Sys, p ui.Printer, c Config) error {
	if c.Central == "" {
		p.Note("no ledger host (the observer machine's tailnet name) — nothing to ship to")
		return nil
	}
	if !quotable(c.SQL) || !quotable(c.StateDir) {
		return errors.New("LEDGER_SQL and LEDGER_STATE_DIR must not contain quotes or backslashes")
	}
	local, central := "postgresql://litellm@"+c.Local, "postgresql://litellm@"+c.Central
	if err := os.MkdirAll(c.StateDir, 0o755); err != nil {
		return err
	}
	mark := filepath.Join(c.StateDir, "shipped")
	since := epoch
	if b, err := os.ReadFile(mark); err == nil {
		since = strings.TrimSpace(string(b))
	}
	if !timestamp.MatchString(since) {
		p.Warn("the watermark is not a timestamp; sending everything again (duplicates are dropped)")
		since = epoch
	}
	// the newest row now, before copying: rows written meanwhile go next time
	out, errOut, err := c.psql(s, local, "", "-v", "ON_ERROR_STOP=1", "-At", "-c",
		`SELECT COALESCE(max("startTime"), timestamp '`+since+`') FROM "LiteLLM_SpendLogs"`)
	if err != nil {
		return fmt.Errorf("this machine's DB did not answer: %s", strings.TrimSpace(errOut))
	}
	newest := strings.TrimSpace(out)
	rows, err := os.CreateTemp(c.StateDir, "rows.")
	if err != nil {
		return err
	}
	rows.Close()
	defer os.Remove(rows.Name())
	if _, errOut, err := c.psql(s, local, "", "-v", "ON_ERROR_STOP=1", "-c",
		`\copy (SELECT * FROM "LiteLLM_SpendLogs" WHERE "startTime" >= timestamp '`+since+`' - interval '1 hour' ORDER BY "startTime") TO '`+rows.Name()+`' WITH (FORMAT csv)`); err != nil {
		return fmt.Errorf("could not read this machine's rows: %s", strings.TrimSpace(errOut))
	}
	if info, err := os.Stat(rows.Name()); err != nil || info.Size() == 0 {
		return nil
	}
	script := `\i ` + c.SQL + `
BEGIN;
CREATE TEMP TABLE incoming (LIKE "LiteLLM_SpendLogs") ON COMMIT DROP;
\copy incoming FROM '` + rows.Name() + `' WITH (FORMAT csv)
INSERT INTO "LiteLLM_SpendLogs" SELECT * FROM incoming ON CONFLICT (request_id) DO NOTHING;
INSERT INTO ledger_origin SELECT request_id, :'machine' FROM incoming ON CONFLICT (request_id) DO NOTHING;
COMMIT;
`
	if _, errOut, err := c.psql(s, central, script, "-v", "ON_ERROR_STOP=1", "-v", "machine="+c.Machine, "-q"); err != nil {
		return fmt.Errorf("the ledger did not take the rows (unreachable, or refused); they are sent next time: %s", strings.TrimSpace(errOut))
	}
	if err := os.WriteFile(mark, []byte(newest+"\n"), 0o644); err != nil {
		return err
	}
	p.Note("shipped rows up to %s", newest)
	return nil
}

// Loop runs Once every interval, forever; a failed run waits for the next.
func Loop(s Sys, p ui.Printer, c Config, interval time.Duration, sleep func(time.Duration)) {
	for {
		if err := Once(s, p, c); err != nil {
			p.Warn("%v", err)
		}
		sleep(interval)
	}
}

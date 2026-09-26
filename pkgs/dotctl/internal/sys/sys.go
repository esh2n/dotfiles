// Package sys is the machine every dotctl command drives: running other
// programs and asking what is installed. Commands take it as an interface so
// tests can stand in for the machine; OS is the real one.
package sys

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// OS runs commands on this machine with this process's environment.
type OS struct{}

// Run runs a command in the foreground on this terminal (sudo may ask). An
// env entry "K=v" sets K; "K=" removes K from the environment.
func (OS) Run(env []string, name string, args ...string) error {
	c := exec.Command(name, args...)
	c.Stdin, c.Stdout, c.Stderr = os.Stdin, os.Stdout, os.Stderr
	if len(env) > 0 {
		c.Env = WithEnv(os.Environ(), env)
	}
	return c.Run()
}

// Output returns what a command prints; its errors still reach the terminal.
func (OS) Output(name string, args ...string) (string, error) {
	c := exec.Command(name, args...)
	c.Stderr = os.Stderr
	out, err := c.Output()
	return string(out), err
}

// Quiet runs a command with no output: a yes/no probe.
func (OS) Quiet(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}

// Cmd is one command run silently by Exec.
type Cmd struct {
	Name    string
	Args    []string
	Env     []string      // "K=v" sets, "K=" removes (see WithEnv)
	Stdin   io.Reader     // nil: no input
	Timeout time.Duration // 0: none
}

// Exec runs a command silently and returns its stdout and stderr. Past its
// timeout the command is killed and the error says so.
func (OS) Exec(c Cmd) (string, string, error) {
	ctx := context.Background()
	if c.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}
	cmd := exec.CommandContext(ctx, c.Name, c.Args...)
	if len(c.Env) > 0 {
		cmd.Env = WithEnv(os.Environ(), c.Env)
	}
	var out, errOut bytes.Buffer
	cmd.Stdin, cmd.Stdout, cmd.Stderr = c.Stdin, &out, &errOut
	err := cmd.Run()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		err = errors.New("timed out after " + c.Timeout.String())
	}
	return out.String(), errOut.String(), err
}

// Capture is Exec with only a command line and a timeout.
func (s OS) Capture(timeout time.Duration, name string, args ...string) (string, string, error) {
	return s.Exec(Cmd{Name: name, Args: args, Timeout: timeout})
}

// Has reports whether a command is on PATH.
func (OS) Has(name string) bool { _, err := exec.LookPath(name); return err == nil }

// OS is "darwin" or "linux".
func (OS) OS() string { return runtime.GOOS }

// Shells is the contents of /etc/shells ("" when unreadable).
func (OS) Shells() string {
	b, err := os.ReadFile("/etc/shells")
	if err != nil {
		return ""
	}
	return string(b)
}

// WithEnv applies "K=v" (set) and "K=" (remove) to base, returning a copy.
func WithEnv(base, changes []string) []string {
	out := append([]string(nil), base...)
	for _, ch := range changes {
		key, val, _ := strings.Cut(ch, "=")
		kept := make([]string, 0, len(out)+1)
		for _, e := range out {
			if !strings.HasPrefix(e, key+"=") {
				kept = append(kept, e)
			}
		}
		if val != "" {
			kept = append(kept, ch)
		}
		out = kept
	}
	return out
}

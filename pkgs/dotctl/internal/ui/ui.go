// Package ui is how every dotctl command talks to the person running it:
// one prefix per command, notes on stdout, warnings on stderr
// (rules/decisions/2026-09-25-dotctl-owns-every-command-with-output.md —
// the one place output helpers live).
package ui

import (
	"fmt"
	"io"
)

// Printer writes "<prefix>: <message>" lines.
type Printer struct {
	Out, Err io.Writer
	Prefix   string
}

// Note is progress the person may want to see.
func (p Printer) Note(format string, a ...any) {
	p.line(p.Out, format, a...)
}

// Warn is something that went wrong but did not stop the command.
func (p Printer) Warn(format string, a ...any) {
	p.line(p.Err, format, a...)
}

// Error is why the command stopped.
func (p Printer) Error(format string, a ...any) {
	p.line(p.Err, format, a...)
}

// With returns a printer whose prefix is extended by one word
// ("setup" -> "setup tpm").
func (p Printer) With(word string) Printer {
	if p.Prefix == "" {
		p.Prefix = word
	} else {
		p.Prefix += " " + word
	}
	return p
}

func (p Printer) line(w io.Writer, format string, a ...any) {
	if w == nil {
		return
	}
	msg := fmt.Sprintf(format, a...)
	if p.Prefix == "" {
		fmt.Fprintln(w, msg)
		return
	}
	fmt.Fprintf(w, "%s: %s\n", p.Prefix, msg)
}

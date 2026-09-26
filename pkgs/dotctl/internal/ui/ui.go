// Package ui is how every dotctl command talks to the person running it
// (rules/decisions/2026-09-25-dotctl-owns-every-command-with-output.md —
// the one place output helpers live). Everything meant for the person —
// progress, results, warnings, lists of what is left to do — goes to
// stdout; only the reason a command stopped goes to stderr. The tags are
// the old shell helpers' ([SUCCESS], [WARN], [ERROR]), coloured the same
// way when the stream is a terminal and NO_COLOR is unset.
package ui

import (
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	red    = "\033[0;31m"
	green  = "\033[0;32m"
	yellow = "\033[0;33m"
	bold   = "\033[1m"
	reset  = "\033[0m"
)

// Printer writes "<prefix>: <message>" lines.
type Printer struct {
	Out, Err io.Writer
	Prefix   string
}

// Note is progress the person may want to see.
func (p Printer) Note(format string, a ...any) {
	p.line(p.Out, "", "", format, a...)
}

// Success is a step that finished.
func (p Printer) Success(format string, a ...any) {
	p.line(p.Out, green, "[SUCCESS] ", format, a...)
}

// Warn is something that went wrong but did not stop the command.
func (p Printer) Warn(format string, a ...any) {
	p.line(p.Out, yellow, "[WARN] ", format, a...)
}

// Error is why the command stopped.
func (p Printer) Error(format string, a ...any) {
	p.line(p.Err, red, "[ERROR] ", format, a...)
}

// Heading starts a block: a blank line, then the title in bold.
func (p Printer) Heading(format string, a ...any) {
	if p.Out == nil {
		return
	}
	title := fmt.Sprintf(format, a...)
	if colour(p.Out) {
		title = bold + title + reset
	}
	fmt.Fprintf(p.Out, "\n%s\n", title)
}

// List writes one indented item per line; an item's continuation lines
// (after "\n") are indented under its text.
func (p Printer) List(items ...string) {
	if p.Out == nil {
		return
	}
	for _, item := range items {
		fmt.Fprintf(p.Out, "  - %s\n", strings.ReplaceAll(item, "\n", "\n    "))
	}
}

// Steps writes numbered items, for instructions done in order.
func (p Printer) Steps(items ...string) {
	if p.Out == nil {
		return
	}
	for i, item := range items {
		fmt.Fprintf(p.Out, "  %d. %s\n", i+1, strings.ReplaceAll(item, "\n", "\n     "))
	}
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

func (p Printer) line(w io.Writer, col, tag, format string, a ...any) {
	if w == nil {
		return
	}
	if tag != "" && colour(w) {
		tag = col + strings.TrimSuffix(tag, " ") + reset + " "
	}
	msg := fmt.Sprintf(format, a...)
	if p.Prefix == "" {
		fmt.Fprintf(w, "%s%s\n", tag, msg)
		return
	}
	fmt.Fprintf(w, "%s%s: %s\n", tag, p.Prefix, msg)
}

// colour is whether w is a terminal that takes escapes.
func colour(w io.Writer) bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

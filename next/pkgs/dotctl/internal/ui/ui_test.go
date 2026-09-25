package ui

import (
	"bytes"
	"testing"
)

func TestPrinterPrefixesAndStreams(t *testing.T) {
	var out, errOut bytes.Buffer
	p := Printer{Out: &out, Err: &errOut, Prefix: "setup"}.With("tpm")
	p.Note("cloning %s", "tpm")
	p.Warn("git is not installed; skipped")
	p.Error("stopped")
	if got := out.String(); got != "setup tpm: cloning tpm\n" {
		t.Fatalf("stdout = %q", got)
	}
	if got := errOut.String(); got != "setup tpm: git is not installed; skipped\nsetup tpm: stopped\n" {
		t.Fatalf("stderr = %q", got)
	}
}

func TestPrinterWithoutPrefixOrWriter(t *testing.T) {
	var out bytes.Buffer
	Printer{Out: &out}.Note("plain")
	if out.String() != "plain\n" {
		t.Fatalf("got %q", out.String())
	}
	Printer{}.Warn("nowhere") // no writer: nothing, no panic
	if (Printer{}).With("a").With("b").Prefix != "a b" {
		t.Fatal("With does not join words")
	}
}

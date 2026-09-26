package ui

import (
	"bytes"
	"os"
	"testing"
)

func TestPrinterPrefixesAndStreams(t *testing.T) {
	var out, errOut bytes.Buffer
	p := Printer{Out: &out, Err: &errOut, Prefix: "setup"}.With("tpm")
	p.Note("cloning %s", "tpm")
	p.Warn("git is not installed; skipped")
	p.Success("installed")
	p.Error("stopped")
	want := "setup tpm: cloning tpm\n[WARN] setup tpm: git is not installed; skipped\n[SUCCESS] setup tpm: installed\n"
	if got := out.String(); got != want {
		t.Fatalf("stdout = %q", got)
	}
	if got := errOut.String(); got != "[ERROR] setup tpm: stopped\n" {
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
	Printer{}.Heading("nowhere")
	Printer{}.List("nowhere")
	Printer{}.Steps("nowhere")
	if (Printer{}).With("a").With("b").Prefix != "a b" {
		t.Fatal("With does not join words")
	}
}

func TestHeadingListAndSteps(t *testing.T) {
	var out bytes.Buffer
	p := Printer{Out: &out}
	p.Heading("Left to do")
	p.List("one", "two\nmore")
	p.Steps("first", "second\ndetail")
	want := "\nLeft to do\n  - one\n  - two\n    more\n  1. first\n  2. second\n     detail\n"
	if out.String() != want {
		t.Fatalf("got %q", out.String())
	}
}

func TestNoColourOffATerminal(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "out")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if colour(f) {
		t.Fatal("a regular file is not a terminal")
	}
	t.Setenv("NO_COLOR", "1")
	if colour(os.Stdout) {
		t.Fatal("NO_COLOR must turn colour off")
	}
}

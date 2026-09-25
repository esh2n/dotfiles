package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunDispatch(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	if err := os.MkdirAll(filepath.Join(h, ".config", "nvim-lazyvim"), 0o755); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := run(nil, &out, &errOut); code != 2 {
		t.Fatalf("no args: exit %d, want 2", code)
	}
	if code := run([]string{"frobnicate"}, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "frobnicate") {
		t.Fatalf("unknown command: exit %d, stderr %q", code, errOut.String())
	}
	out.Reset()
	if code := run([]string{"nvim", "lazyvim"}, &out, &errOut); code != 0 {
		t.Fatalf("nvim lazyvim: exit %d, stderr %q", code, errOut.String())
	}
	out.Reset()
	run([]string{"nvim", "list"}, &out, &errOut)
	if !strings.Contains(out.String(), "* lazyvim") {
		t.Fatalf("list did not mark lazyvim active: %q", out.String())
	}
	if code := run([]string{"nvim", "emacs"}, &out, &errOut); code != 1 {
		t.Fatalf("nvim emacs: exit %d, want 1", code)
	}
}

func TestCacheGCReadsItsLimitsFromTheEnvironment(t *testing.T) {
	t.Setenv("CBM_CACHE_DIR", t.TempDir())
	t.Setenv("CODE_GRAPH_CACHE_TTL_DAYS", "seven")
	var out, errOut bytes.Buffer
	if code := runCacheGC(t.TempDir(), []string{"--force"}, nil, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "CODE_GRAPH_CACHE_TTL_DAYS") {
		t.Fatalf("bad TTL: exit %d, stderr %q", code, errOut.String())
	}
	t.Setenv("CODE_GRAPH_CACHE_TTL_DAYS", "7")
	repo := t.TempDir()
	if code := runCacheGC(t.TempDir(), []string{"--touch", repo}, nil, &out, &errOut); code != 0 {
		t.Fatalf("--touch: exit %d, stderr %q", code, errOut.String())
	}
	if code := runCacheGC(t.TempDir(), []string{"--bogus"}, nil, &out, &errOut); code != 2 {
		t.Fatalf("unknown flag: exit %d", code)
	}
}

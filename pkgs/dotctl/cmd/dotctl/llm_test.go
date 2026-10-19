package main

import (
	"bytes"
	"strings"
	"testing"
)

// The flags named for a product or a part stop with the role that replaced
// them, before anything runs.
func TestLLMRenamedFlagsNameTheirRole(t *testing.T) {
	for _, c := range []struct{ arg, want string }{
		{"--lmstudio", "--lmstudio is now --model-provider"},
		{"-gpu", "--gpu is now --model-provider"},
		{"--console=true", "--console is now --observer"},
	} {
		var out, errOut bytes.Buffer
		code := runLLM(t.TempDir(), []string{"check", "--repo", t.TempDir(), c.arg}, &out, &errOut)
		if code != 2 || !strings.Contains(errOut.String(), c.want) || out.Len() != 0 {
			t.Errorf("%s: exit %d, stdout %q, stderr %q", c.arg, code, out.String(), errOut.String())
		}
	}
	if old, _ := renamedOfferFlag([]string{"--", "--gpu"}); old != "" {
		t.Errorf("a flag after -- was read as renamed: %q", old)
	}
}

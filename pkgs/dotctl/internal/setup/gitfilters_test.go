package setup

import (
	"strings"
	"testing"
)

func TestGitFiltersSetsTheCleanFilterInTheCheckout(t *testing.T) {
	w := newWorld(t, "git", "jq")
	if err := Run(w.env, "git-filters"); err != nil {
		t.Fatal(err)
	}
	want := "git -C " + w.repo + " config filter.pi-runtime-keys.clean " + piRuntimeKeysClean
	if !w.sys.ran(want) {
		t.Fatalf("calls %v, want %q", w.sys.calls, want)
	}
}

func TestGitFiltersLeavesAMatchingFilterAlone(t *testing.T) {
	w := newWorld(t, "git", "jq")
	w.sys.outputs["git -C "+w.repo+" config --get filter.pi-runtime-keys.clean"] = piRuntimeKeysClean + "\n"
	if err := Run(w.env, "git-filters"); err != nil {
		t.Fatal(err)
	}
	for _, c := range w.sys.calls {
		if !strings.Contains(c, "--get") {
			t.Fatalf("must not write a filter already set: %v", w.sys.calls)
		}
	}
}

func TestGitFiltersSkipsWithoutJq(t *testing.T) {
	w := newWorld(t, "git")
	if err := Run(w.env, "git-filters"); err != nil || len(w.sys.calls) != 0 {
		t.Fatalf("%v %v", err, w.sys.calls)
	}
	if !strings.Contains(w.out.String(), "jq is not installed") {
		t.Fatalf("out %q", w.out.String())
	}
}

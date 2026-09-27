package llm

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
)

// Use points a tier at catalog models (harness/policy/models.json ids, in
// LiteLLM order) and puts LiteLLM on the result: jig rewrites the tier's
// `use` in harness/policy/tiers.json, regenerates every file made from the
// tiers (LiteLLM's config.yaml among them), then restart brings LiteLLM up on
// it (rules/decisions/2026-09-27-model-catalog-and-tier-assignment.md).
func Use(e Env, tier string, models []string, restart func() error) error {
	if tier == "" || len(models) == 0 {
		return fmt.Errorf("name a tier and at least one catalog model")
	}
	jig := filepath.Join(e.Repo, "harness", "bin", "jig")
	steps := []struct {
		what string
		args []string
	}{
		{"point " + tier + " at " + strings.Join(models, " → "), append([]string{"tiers", "use", tier}, models...)},
		{"regenerate the files made from the tiers", []string{"apply", "--target", "all", "--write"}},
	}
	for _, s := range steps {
		out, errOut, err := e.Sys.Exec(sys.Cmd{Name: jig, Args: s.args, Timeout: 2 * time.Minute})
		if err != nil {
			return fmt.Errorf("%s: jig %s: %v\n%s", s.what, strings.Join(s.args, " "), err, strings.TrimSpace(errOut+"\n"+out))
		}
		e.UI.Success("%s", s.what)
	}
	if err := restart(); err != nil {
		return fmt.Errorf("restart LiteLLM: %w", err)
	}
	e.UI.Success("LiteLLM is up with %s → %s", tier, strings.Join(models, " → "))
	return nil
}

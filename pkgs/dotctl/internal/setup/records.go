package setup

import (
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/records"
)

// recordsTTL names the flow documents (research records, plans) past their
// TTL, so make up says what is waiting to be promoted or removed. It only
// warns: promoting is a judgment the records-triage skill makes, and
// removing is `dotctl records prune --yes`, run on purpose.
func recordsTTL(e Env) error {
	expired, err := records.Expired(e.Repo, e.Now(), records.TTL, e.firstCommit())
	if err != nil {
		return err
	}
	if len(expired) == 0 {
		return nil
	}
	for _, it := range expired {
		e.UI.Warn("past its %d days: %s (%s)", int(records.TTL.Hours()/24), it.Path, it.Date.Format("2006-01-02"))
	}
	e.UI.Warn("promote what lasts with /records-triage, then remove the rest: dotctl records prune --yes")
	return nil
}

// firstCommit dates by git when it is installed; without git an undated
// entry stays undated.
func (e Env) firstCommit() records.DateOf {
	if !e.Sys.Has("git") {
		return func(string) (time.Time, bool) { return time.Time{}, false }
	}
	return records.GitFirstCommit(e.Repo, e.Sys.Capture)
}

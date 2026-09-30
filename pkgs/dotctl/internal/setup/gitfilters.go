package setup

import (
	"strings"
	"time"
)

// piRuntimeKeysClean is the clean filter .gitattributes names for pi's
// settings.json: pi writes lastChangelogVersion into it on every upgrade,
// through the link into the checkout, and that key is state, not config.
// The filter drops it from what git stores, so an upgrade leaves the tree
// clean while pi keeps reading and writing its file as before.
const piRuntimeKeysClean = "jq --indent 2 'del(.lastChangelogVersion)'"

// gitFilters registers the checkout's clean filters in its own git config.
// A filter's command cannot live in the repository (git reads it only from
// config), so each machine sets it here; one already set is left alone.
func gitFilters(e Env) error {
	if !e.need("git") || !e.need("jq") {
		return nil
	}
	key := "filter.pi-runtime-keys.clean"
	current, _, _ := e.Sys.Capture(time.Minute, "git", "-C", e.Repo, "config", "--get", key)
	if strings.TrimSpace(current) == piRuntimeKeysClean {
		return nil
	}
	return e.Sys.Run(nil, "git", "-C", e.Repo, "config", key, piRuntimeKeysClean)
}

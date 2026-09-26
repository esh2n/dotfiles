package main

import (
	"flag"
	"io"
	"os"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/service"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

const serviceUsage = `usage: dotctl service restart <name> [--health URL]
  restarts a service lib/mk-service.nix declares (launchd com.esh2n.<name> on macOS,
  systemd --user <name> on Linux); --health waits for URL to answer
`

// runService is `dotctl service restart <name> [--health URL]`.
func runService(args []string, out, errOut io.Writer) int {
	if len(args) < 2 || args[0] != "restart" {
		io.WriteString(errOut, serviceUsage)
		return 2
	}
	fs := flag.NewFlagSet("service restart", flag.ContinueOnError)
	fs.SetOutput(errOut)
	health := fs.String("health", "", "a URL that answers 2xx once the service is up")
	name := args[1]
	if err := fs.Parse(args[2:]); err != nil || fs.NArg() > 0 {
		io.WriteString(errOut, serviceUsage)
		return 2
	}
	p := ui.Printer{Out: out, Err: errOut, Prefix: "service"}
	if err := service.Restart(service.Env{Sys: sys.OS{}, UI: p, UID: os.Getuid()}, name, *health); err != nil {
		p.Error("%v", err)
		return 1
	}
	return 0
}

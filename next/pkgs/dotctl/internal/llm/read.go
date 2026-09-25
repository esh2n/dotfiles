package llm

import (
	"io"
	"net/http"
)

// readAll reads a response body, at most 8 MiB.
func readAll(resp *http.Response) ([]byte, error) {
	return io.ReadAll(io.LimitReader(resp.Body, 8<<20))
}

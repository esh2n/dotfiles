// Package wallpaper fetches wallpapers from Wallhaven and sets them on every
// macOS desktop (was domains/creative/bin/wallpaper). Downloads are kept in
// the checkout's home/shared/theme/wallpapers; ~/.current_wallpaper
// links the one in use.
package wallpaper

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// API is Wallhaven's search endpoint.
const API = "https://wallhaven.cc/api/v1/search"

// Sys is the machine. sys.OS is the real one.
type Sys interface {
	Exec(c sys.Cmd) (string, string, error)
	OS() string
}

// Search narrows what Wallhaven returns.
type Search struct {
	Query    string
	Purity   string // 100 SFW (default), 110, 111
	Category string // 111 general/anime/people (default)
	Sorting  string // random (default), date_added, relevance, views, favorites, toplist
}

// Env is where downloads go and how they are fetched and set.
type Env struct {
	Home, Repo string
	Sys        Sys
	UI         ui.Printer
	HTTP       *http.Client
	API        string // default API
}

var (
	digits  = regexp.MustCompile(`^[0-9]{3}$`)
	sorting = map[string]bool{"date_added": true, "relevance": true, "random": true, "views": true, "favorites": true, "toplist": true}
	imageID = regexp.MustCompile(`^[A-Za-z0-9]+$`)
	imageEx = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true}
)

func (s Search) query() (string, error) {
	pick := func(v, def string) string {
		if v == "" {
			return def
		}
		return v
	}
	purity, category, sort := pick(s.Purity, "100"), pick(s.Category, "111"), pick(s.Sorting, "random")
	if !digits.MatchString(purity) || !digits.MatchString(category) || !sorting[sort] {
		return "", fmt.Errorf("purity and category are three digits (e.g. 100, 111); sorting is one of date_added, relevance, random, views, favorites, toplist")
	}
	q := url.Values{"purity": {purity}, "categories": {category}, "sorting": {sort}}
	if s.Query != "" {
		q.Set("q", s.Query)
	}
	return q.Encode(), nil
}

func (e Env) dir() string {
	return filepath.Join(e.Repo, "home", "shared", "theme", "wallpapers")
}

// Fetch finds one wallpaper for the search, downloads it once, and sets it.
func Fetch(e Env, s Search) error {
	q, err := s.query()
	if err != nil {
		return err
	}
	api := e.API
	if api == "" {
		api = API
	}
	client := e.HTTP
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	e.UI.Note("searching Wallhaven for %s", orRandom(s.Query))
	var result struct {
		Data []struct{ ID, Path string } `json:"data"`
	}
	if err := getJSON(client, api+"?"+q, &result); err != nil {
		return fmt.Errorf("search on Wallhaven: %w", err)
	}
	if len(result.Data) == 0 {
		return fmt.Errorf("no wallpapers found for %s", orRandom(s.Query))
	}
	img := result.Data[0]
	u, err := url.Parse(img.Path)
	ext := strings.ToLower(path.Ext(img.Path))
	if err != nil || u.Scheme != "https" || !(u.Host == "wallhaven.cc" || strings.HasSuffix(u.Host, ".wallhaven.cc")) || !imageID.MatchString(img.ID) || !imageEx[ext] {
		return fmt.Errorf("unexpected image from Wallhaven: id %q, path %q", img.ID, img.Path)
	}
	file := filepath.Join(e.dir(), "wallhaven-"+img.ID+ext)
	if _, err := os.Stat(file); err != nil {
		e.UI.Note("downloading %s", img.ID)
		if err := download(client, img.Path, file); err != nil {
			return err
		}
	}
	return Set(e, file)
}

func orRandom(q string) string {
	if q == "" {
		return "a random wallpaper"
	}
	return q
}

func getJSON(c *http.Client, u string, into any) error {
	resp, err := c.Get(u)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%s answered %s", u, resp.Status)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(into)
}

func download(c *http.Client, u, file string) error {
	resp, err := c.Get(u)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("download %s: %s", u, resp.Status)
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	tmp := file + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, io.LimitReader(resp.Body, 256<<20))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, file)
}

// appleString quotes text as an AppleScript string literal.
func appleString(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

// Set puts a local image on every desktop and links it as
// ~/.current_wallpaper. macOS only.
func Set(e Env, file string) error {
	if e.Sys.OS() != "darwin" {
		return errors.New("setting the wallpaper is macOS only")
	}
	abs, err := filepath.Abs(file)
	if err != nil {
		return err
	}
	if info, err := os.Stat(abs); err != nil || info.IsDir() {
		return fmt.Errorf("no image at %s", abs)
	}
	script := "tell application \"System Events\" to tell every desktop to set picture to " + appleString(abs)
	if _, errOut, err := e.Sys.Exec(sys.Cmd{Name: "osascript", Args: []string{"-e", script}, Timeout: 30 * time.Second}); err != nil {
		return fmt.Errorf("osascript: %v: %s", err, strings.TrimSpace(errOut))
	}
	link := filepath.Join(e.Home, ".current_wallpaper")
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Symlink(abs, link); err != nil {
		return err
	}
	e.UI.Note("wallpaper is %s", abs)
	return nil
}

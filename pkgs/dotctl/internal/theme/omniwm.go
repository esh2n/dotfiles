package theme

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// bordersColours is the active and inactive 6-digit colour of a borders theme
// file; a gradient's top-left colour stands for the gradient.
func bordersColours(path string) (active, inactive string, err error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	pick := func(key string) (string, error) {
		re := regexp.MustCompile(`(?m)^` + key + `="(?:gradient\(top_left=)?0x[0-9a-fA-F]{2}([0-9a-fA-F]{6})`)
		m := re.FindSubmatch(b)
		if m == nil {
			return "", fmt.Errorf("%s: no %s colour", filepath.Base(path), key)
		}
		return strings.ToLower(string(m[1])), nil
	}
	if active, err = pick("active_color"); err != nil {
		return "", "", err
	}
	if inactive, err = pick("inactive_color"); err != nil {
		return "", "", err
	}
	return active, inactive, nil
}

// rgbLines are OmniWM's red/green/blue entries (0-1 floats) for a 6-digit
// colour; ok is false for anything else, so a missing palette key is never
// written as black.
func rgbLines(hex string) (values map[string]string, ok bool) {
	v, err := strconv.ParseUint(hex, 16, 32)
	if err != nil || len(hex) != 6 {
		return nil, false
	}
	f := func(shift uint) string {
		return strconv.FormatFloat(float64(v>>shift&0xff)/255, 'f', -1, 64)
	}
	return map[string]string{"red": f(16), "green": f(8), "blue": f(0)}, true
}

// setInSection replaces `key = value` lines inside one [section] of a TOML
// text, leaving every other section (and keys it does not name) as they are.
// missing names the keys it did not find there, so a file OmniWM has started
// writing differently is reported rather than silently left alone.
func setInSection(text, section string, values map[string]string) (out string, missing []string) {
	lines := strings.Split(text, "\n")
	done := map[string]bool{}
	in := false
	for i, l := range lines {
		if strings.HasPrefix(l, "[") {
			in = l == "["+section+"]"
			continue
		}
		if !in {
			continue
		}
		key, _, ok := strings.Cut(l, " = ")
		if !ok {
			continue
		}
		if v, has := values[key]; has {
			lines[i] = key + " = " + v
			done[key] = true
		}
	}
	for k := range values {
		if !done[k] {
			missing = append(missing, k)
		}
	}
	return strings.Join(lines, "\n"), missing
}

// applyOmniWM is one step of applyValues (apply.go). OmniWM has no include,
// so its colours are rewritten in place in the checkout's settings.toml
// (~/.config/omniwm links to it); OmniWM watches the file and applies a save
// at once (omniwm.app/config/configuration). The focus border follows the
// choice already made per theme for borders
// (home/darwin/borders/config/themes/<name>.sh), the overview the palette.
// OmniWM has no inactive border colour, so only the focus side follows.
//
//declscope:package
func applyOmniWM(e Env, name string) error {
	if e.omarchy() {
		return nil // OmniWM is a Mac program
	}
	cfg := e.repo("home/darwin/omniwm/config/settings.toml")
	if !exists(cfg) {
		return nil // not a Mac, or OmniWM not set up
	}
	p, err := readPalette(e.repo(Apps[0].Source(name)))
	if err != nil {
		return err
	}
	active, inactive, err := bordersColours(e.repo("home/darwin/borders/config/themes/" + name + ".sh"))
	if err != nil {
		e.warn("OmniWM keeps its colours: borders theme '%s' is unusable (%v)", name, err)
		return nil
	}
	h := p.Hex
	b, err := os.ReadFile(cfg)
	if err != nil {
		return err
	}
	text := string(b)
	var missing []string
	set := func(section string, values map[string]string) {
		var gone []string
		text, gone = setInSection(text, section, values)
		for _, k := range gone {
			missing = append(missing, section+"."+k)
		}
	}
	for _, s := range []struct{ section, hex string }{
		{"borders.color", active},
		{"overview.backdrop", h("base")},
		{"overview.windowBorders.selected", active},
		{"overview.windowBorders.hovered", inactive},
		{"overview.windowBorders.normal", h("overlay0")},
	} {
		values, ok := rgbLines(s.hex)
		if !ok {
			e.warn("OmniWM %s keeps its colour: %q is not a colour", s.section, s.hex)
			continue
		}
		set(s.section, values)
	}
	set("appearance", map[string]string{"mode": `"` + p.Variant() + `"`})
	if len(missing) > 0 {
		e.warn("OmniWM settings.toml has no %s; OmniWM may have changed how it writes the file", strings.Join(missing, ", "))
	}
	if text == string(b) {
		return nil
	}
	return writeAtomic(cfg, []byte(text))
}

package theme

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
)

// Palette is the colour table of a theme's lua file (0xffRRGGBB entries).
type Palette struct {
	Light bool
	src   []byte
}

func readPalette(path string) (Palette, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Palette{}, err
	}
	return Palette{Light: regexp.MustCompile(`variant.*=.*"light"`).Match(b), src: b}, nil
}

// Hex is the 6-digit colour of key, "" when the palette has none.
func (p Palette) Hex(key string) string {
	re := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*=.*0xff([a-f0-9]{6})`)
	if m := re.FindSubmatch(p.src); m != nil {
		return string(m[1])
	}
	return ""
}

// Variant is "light" or "dark".
func (p Palette) Variant() string {
	if p.Light {
		return "light"
	}
	return "dark"
}

// xterm256 is the nearest xterm-256 cube index of a hex colour (ripgrep's
// --colors takes indices, not hex); 7 when the colour is malformed.
func xterm256(hex string) int {
	if len(hex) != 6 {
		return 7
	}
	v, err := strconv.ParseUint(hex, 16, 32)
	if err != nil {
		return 7
	}
	step := func(c int) int {
		switch {
		case c < 48:
			return 0
		case c < 115:
			return 1
		default:
			return (c - 35) / 40
		}
	}
	r, g, b := int(v>>16&0xff), int(v>>8&0xff), int(v&0xff)
	return 16 + 36*step(r) + 6*step(g) + step(b)
}

// scaled divides each channel of a hex colour (delta's dimmed diff colours).
func scaled(hex string, by int) string {
	v, err := strconv.ParseUint(hex, 16, 32)
	if err != nil || len(hex) != 6 {
		return hex
	}
	return fmt.Sprintf("%02x%02x%02x", int(v>>16&0xff)/by, int(v>>8&0xff)/by, int(v&0xff)/by)
}

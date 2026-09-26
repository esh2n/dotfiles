// Package templates renders every *.template in the checkout into the file
// beside it (was pkgs/scripts/render-templates):
//
//	{{HOME}} {{USER}} {{DOTFILES_ROOT}}  the machine's values
//	{{CONDITIONAL_INCLUDES}}             git include / includeIf sections
//	                                     built from home/shared/git/config/
//	                                     conditional/*.conf (machine-local,
//	                                     untracked; a conf whose first
//	                                     "# GITDIR: <dir>" line names a
//	                                     directory becomes includeIf)
//
// The rendered files are working copies (dotctl theme and the tools write to
// them), so they stay in the checkout, gitignored. Idempotent.
package templates

import (
	"bufio"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Values fill the placeholders.
type Values struct{ Home, User, Root string }

func conditionalDir(root string) string {
	return filepath.Join(root, "home", "shared", "git", "config", "conditional")
}

// Includes builds the git include sections from the conditional confs; ok is
// whether the directory exists (the renderer then adds one blank line).
func Includes(root, home string) (text string, ok bool, err error) {
	dir := conditionalDir(root)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	var names []string
	for _, e := range entries {
		if e.Type().IsRegular() && strings.HasSuffix(e.Name(), ".conf") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	var b strings.Builder
	for _, n := range names {
		gitdir, err := gitDir(filepath.Join(dir, n))
		if err != nil {
			return "", true, err
		}
		gitdir = strings.ReplaceAll(gitdir, "{{HOME}}", home)
		if gitdir != "" {
			fmt.Fprintf(&b, "[includeIf \"gitdir:%s\"]\n    path = ~/.config/git/conditional/%s\n", gitdir, n)
		} else {
			fmt.Fprintf(&b, "[include]\n    path = ~/.config/git/conditional/%s\n", n)
		}
	}
	return strings.TrimSuffix(b.String(), "\n"), true, nil
}

// gitDir is the first "# GITDIR: <dir>" line's directory, "" when none.
func gitDir(file string) (string, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if rest, ok := strings.CutPrefix(sc.Text(), "# GITDIR:"); ok {
			return strings.TrimLeft(rest, " "), nil
		}
	}
	return "", sc.Err()
}

// Render fills one template's text.
func Render(text string, v Values, includes string, hasConditional bool) string {
	text = strings.NewReplacer("{{HOME}}", v.Home, "{{USER}}", v.User, "{{DOTFILES_ROOT}}", v.Root).Replace(text)
	if !strings.Contains(text, "{{CONDITIONAL_INCLUDES}}") {
		return text
	}
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		if !strings.Contains(l, "{{CONDITIONAL_INCLUDES}}") {
			out = append(out, l)
			continue
		}
		if includes != "" {
			out = append(out, includes)
		}
		if hasConditional {
			out = append(out, "")
		}
	}
	return strings.Join(out, "\n")
}

// RenderAll renders every *.template under the checkout (node_modules and
// .git skipped) and returns how many it wrote.
func RenderAll(v Values) (int, error) {
	info, err := os.Stat(v.Root)
	if err != nil || !info.IsDir() {
		return 0, fmt.Errorf("no checkout at %s", v.Root)
	}
	includes, hasConditional, err := Includes(v.Root, v.Home)
	if err != nil {
		return 0, err
	}
	n := 0
	err = filepath.WalkDir(v.Root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "node_modules" || d.Name() == ".git") {
			return filepath.SkipDir
		}
		if !d.Type().IsRegular() || !strings.HasSuffix(d.Name(), ".template") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := writeAtomic(strings.TrimSuffix(path, ".template"), Render(string(b), v, includes, hasConditional)); err != nil {
			return err
		}
		n++
		return nil
	})
	return n, err
}

func writeAtomic(path, text string) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".")
	if err != nil {
		return err
	}
	_, err = tmp.WriteString(text)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp.Name(), 0o600) // as the shell renderer left them
	}
	if err == nil {
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		_ = os.Remove(tmp.Name())
	}
	return err
}

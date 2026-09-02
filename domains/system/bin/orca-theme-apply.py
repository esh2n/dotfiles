#!/usr/bin/env python3
"""Apply a theme to Orca's settings store. Called by theme-switch.

Usage: orca-theme-apply.py <orca-support-dir> <variant:dark|light> <warp-theme-name>

Orca (onorca.dev) persists all settings in one app-state JSON at
profiles/<activeProfileId>/orca-data.json under its Electron userData dir.
There is no CLI/IPC/deep-link to change settings (verified 2026-09), and the
running app is the storage authority — theme-switch guards with pgrep before
invoking this script so we never race the app's own debounced writes.

What it writes:
- settings.theme            -> "dark" | "light" (UI theme, from palette variant)
- settings.terminalThemeDark / terminalThemeLight -> the Warp theme's display
  name (Orca auto-discovers ~/.warp/themes/*.yaml in Warp format and lists
  each by its yaml `name:` field; a one-time import in Settings -> Terminal
  makes them selectable).

The write is atomic (temp file + os.replace) and refuses to touch a file
whose schema doesn't look like Orca's, so an app update that reshapes the
store fails loudly instead of corrupting it.
"""

import json
import os
import sys
import tempfile


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: orca-theme-apply.py <support-dir> <dark|light> <warp-name>")
        return 2
    support_dir, variant, warp_name = sys.argv[1], sys.argv[2], sys.argv[3]

    index_path = os.path.join(support_dir, "orca-profile-index.json")
    with open(index_path, encoding="utf-8") as f:
        profile = json.load(f).get("activeProfileId", "local-default")

    data_path = os.path.join(support_dir, "profiles", profile, "orca-data.json")
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)

    settings = data.get("settings")
    if not isinstance(settings, dict) or "theme" not in settings:
        print("settings block not found — Orca schema changed, refusing to write")
        return 1

    settings["theme"] = "light" if variant == "light" else "dark"
    applied = ["ui:" + settings["theme"]]
    if warp_name:
        key = "terminalThemeLight" if variant == "light" else "terminalThemeDark"
        settings[key] = warp_name
        applied.append(f"{key}:{warp_name}")

    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(data_path), prefix=".orca-data.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, data_path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

    print(", ".join(applied))
    return 0


if __name__ == "__main__":
    sys.exit(main())

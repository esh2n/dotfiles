#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
"""workday-calc: deterministic time arithmetic for the workday-calc skill.

Does ONLY arithmetic (rounding, early-start/overtime correction, lunch-break
deduction, Workday entry splitting). All judgment calls (isolated-message gap
filtering, holiday/business-day determination, office/remote overrides, leave
detection) happen upstream in SKILL.md Step 1-2.6 and are passed in already
resolved -- this script never re-derives them.

Usage:
    echo '<json>' | uv run scripts/calc.py
    uv run scripts/calc.py --selftest

Input JSON (stdin):
{
  "default_start": "09:30",   # optional, default "09:30"
  "default_end": "19:00",     # optional, default "19:00"
  "days": [
    {
      "date": "2026-03-16",             # required, YYYY-MM-DD
      "slack_first": "09:12" | null,    # already isolation-filtered (Step2)
      "slack_last": "19:40" | null,
      "git_first": "08:55" | null,      # already isolation-filtered (Step2.5)
      "git_last": "21:03" | null,
      "is_workday": true,               # false = weekend/holiday -> skipped
      "leave": null,                    # null|"full"|"sick"|"am"|"pm"
      "location": "remote" | "office" | null,  # null -> Tue=office else remote
      "is_today": false                 # true -> flags "provisional_end"
    }
  ]
}

Output: JSON list, one object per day, with computed start/end, entries
(Workday-ready, split at the 12:00-13:00 lunch break only when the work span
crosses it), work_hours, and anomaly flags. No narrative/memo text -- that
stays the caller's (LLM's) job.

Rounding rule (per SKILL.md): start time rounds DOWN to 15min, end time
rounds UP to 15min. Only applied when activity pushes the boundary outside
the default range -- values already within default stay untouched.
"""
import argparse
import datetime
import json
import sys

LUNCH_START, LUNCH_END = 12 * 60, 13 * 60
LONG_HOURS_THRESHOLD = 11.0


def parse_time(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def fmt_time(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def floor15(m):
    return m - (m % 15)


def ceil15(m):
    return m + ((15 - m % 15) % 15)


def default_location(date_str):
    weekday = datetime.date.fromisoformat(date_str).weekday()  # Mon=0, Tue=1
    return "office" if weekday == 1 else "remote"


def compute_day(day, default_start_m, default_end_m):
    date = day["date"]

    if not day.get("is_workday", True):
        return {"date": date, "status": "non_workday", "entries": [], "work_hours": 0.0, "flags": []}

    leave = day.get("leave")
    if leave in ("full", "sick"):
        return {"date": date, "status": f"leave_{leave}", "entries": [], "work_hours": 0.0, "flags": []}

    firsts = [parse_time(t) for t in (day.get("slack_first"), day.get("git_first")) if t]
    lasts = [parse_time(t) for t in (day.get("slack_last"), day.get("git_last")) if t]
    activity_first = min(firsts) if firsts else None
    activity_last = max(lasts) if lasts else None

    flags = []
    if activity_first is None and activity_last is None:
        flags.append("no_activity")

    start_m, correction_start = default_start_m, None
    if activity_first is not None and activity_first < default_start_m:
        start_m = floor15(activity_first)
        correction_start = f"{fmt_time(default_start_m)}->{fmt_time(start_m)}"

    end_m, correction_end = default_end_m, None
    if activity_last is not None and activity_last > default_end_m:
        end_m = ceil15(activity_last)
        correction_end = f"{fmt_time(default_end_m)}->{fmt_time(end_m)}"

    if leave == "am":
        start_m, correction_start = 13 * 60, None
    elif leave == "pm":
        end_m, correction_end = 13 * 60, None

    crosses_lunch = start_m < LUNCH_START and end_m > LUNCH_END
    if crosses_lunch:
        entries = [[fmt_time(start_m), "12:00"], ["13:00", fmt_time(end_m)]]
        work_minutes = (end_m - start_m) - 60
    else:
        entries = [[fmt_time(start_m), fmt_time(end_m)]]
        work_minutes = end_m - start_m

    work_hours = round(work_minutes / 60, 2)
    if work_hours >= LONG_HOURS_THRESHOLD:
        flags.append("long_hours")
    if day.get("is_today"):
        flags.append("provisional_end")

    return {
        "date": date,
        "status": "worked",
        "location": day.get("location") or default_location(date),
        "start_time": fmt_time(start_m),
        "end_time": fmt_time(end_m),
        "entries": entries,
        "break_deducted": crosses_lunch,
        "work_hours": work_hours,
        "activity_first": fmt_time(activity_first) if activity_first is not None else None,
        "activity_last": fmt_time(activity_last) if activity_last is not None else None,
        "correction_start": correction_start,
        "correction_end": correction_end,
        "flags": flags,
    }


def run(payload):
    default_start_m = parse_time(payload.get("default_start", "09:30"))
    default_end_m = parse_time(payload.get("default_end", "19:00"))
    return [compute_day(d, default_start_m, default_end_m) for d in payload.get("days", [])]


def selftest():
    cases = [
        (  # normal day (SKILL.md Step4 example, 3/2)
            {"date": "2026-03-02", "slack_first": "09:35", "slack_last": "18:45",
             "git_first": "10:12", "git_last": "17:50", "is_workday": True},
            {"start_time": "09:30", "end_time": "19:00", "work_hours": 8.5,
             "entries": [["09:30", "12:00"], ["13:00", "19:00"]]},
        ),
        (  # overtime day (SKILL.md Step4 example, 3/17)
            {"date": "2026-03-17", "slack_first": "09:45", "slack_last": "18:39",
             "git_first": "10:03", "git_last": "20:41", "is_workday": True},
            {"start_time": "09:30", "end_time": "20:45", "work_hours": 10.25},
        ),
        (  # early start + overtime (SKILL.md Step3 example, 8:15-21:00)
            {"date": "2026-03-05", "slack_first": "08:20", "slack_last": "20:50",
             "git_first": "08:15", "git_last": "21:00", "is_workday": True},
            {"start_time": "08:15", "end_time": "21:00", "work_hours": 11.75},
        ),
        (  # am half day (SKILL.md Step3 example, 13:00-19:00)
            {"date": "2026-03-03", "slack_last": "18:00", "is_workday": True, "leave": "am"},
            {"start_time": "13:00", "end_time": "19:00", "work_hours": 6.0,
             "entries": [["13:00", "19:00"]]},
        ),
        (  # pm half day (SKILL.md Step3 example, 9:30-13:00)
            {"date": "2026-03-04", "slack_first": "09:35", "is_workday": True, "leave": "pm"},
            {"start_time": "09:30", "end_time": "13:00", "work_hours": 3.5,
             "entries": [["09:30", "13:00"]]},
        ),
        (  # full leave day
            {"date": "2026-03-27", "is_workday": True, "leave": "full"},
            {"status": "leave_full", "work_hours": 0.0},
        ),
        (  # non-workday (weekend/holiday)
            {"date": "2026-03-08", "is_workday": False},
            {"status": "non_workday", "work_hours": 0.0},
        ),
    ]
    for day, expected in cases:
        result = compute_day(day, parse_time("09:30"), parse_time("19:00"))
        for k, v in expected.items():
            assert result.get(k) == v, f"{day['date']}: {k} expected {v!r}, got {result.get(k)!r}"
    print(f"PASS ({len(cases)} cases)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--selftest", action="store_true", help="run built-in assertions and exit")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    payload = json.load(sys.stdin)
    json.dump(run(payload), sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()

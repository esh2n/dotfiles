---
name: workday-input
description: "Enter work hours into Workday's time-entry screen through Chrome, using the data computed by workday-calc. Run under claude --chrome."
disable-model-invocation: true
metadata:
  namespaces: [work]
---

# Workday Input — time entry

Enter the work-hour data computed and saved by `/workday-calc` into Workday's time-entry screen through the Chrome browser.

## Prerequisites

- Started with `claude --chrome` (the `Claude in Chrome` extension is required)
- Already SSO-logged-in to Workday
- `/workday-calc` results saved at `~/workday-reports/{YYYY}/{MM}.txt`

## Usage

```
/workday-input              # enter using the latest report
/workday-input 2026-03      # enter using the report for the given month
```

## Step 1: Load the data

Read `~/workday-reports/{YYYY}/{MM}.txt` and identify the days to enter.

If the file does not exist, tell the user to run `/workday-calc` first and stop.

### Data format

```
3/2(月) 9:30-19:00 休憩12:00-13:00 リモート
3/3(火) 9:30-13:00 午後半休 出社
3/4(水) 病欠(年次有給休暇・終日)
```

## Step 2: Open Workday

Open Workday's time-entry screen in Chrome.

The URL comes from `WORKDAY_CALENDAR_URL` in `~/.config/workday/config` (if missing, tell the user to create it and stop).

`tabs_context_mcp` → `tabs_create_mcp` or `navigate` in an existing tab.

## Step 3: Check the week view

Workday displays one week at a time.
- Header shows one column per day; time slots are rows
- `前へ` / `次へ` buttons move between weeks
- Move to the first week of the target month before starting entry

## Step 4: Enter each day

**Flow per entry (overview)**: click an empty cell → select time type 「勤務時間」 →
enter start/end → select office/remote → OK → screenshot and check the header hours.
The detailed steps below walk through this flow while verifying the screen state at each step.

### Pre-check

Confirm the workday-calc output file exists and covers the target period before starting.
If not, tell the user to run workday-calc first and stop.

### Important: entry verification rule

**After pressing OK on every entry, take a screenshot and check the header hours.**
Moving on to the next day without checking hides missed entries.

- After OK → wait 2 seconds → screenshot → check the header `時間: X` is the expected value → if OK, next
- If it differs from the expected value, click that entry to inspect and fix it

### Regular day (2 entries)

Enter one day's work hours as **2 entries split at the break**.

**Entry 1 (morning)**:
1. Click an **empty cell** on the target day's calendar (an area with no existing entry) → the 「時間の入力」 dialog opens
   - ⚠️ Clicking an existing entry (a work-hours block etc.) opens the edit/detail screen — avoid it
   - ⚠️ Clicking the header row (absence days etc.) opens the "time block" detail — avoid it
   - Clicking an empty cell opens the 「時間の入力」 dialog (time type unselected, hours: 0)
2. Select the time type:
   a. Click the list icon (≡) → the category list expands
   b. Click 「時間エントリ コード」 → the sub-list expands
   c. Click the 「勤務時間」 radio button
   d. → The form now shows the fields 「開始」「終了」「終了理由」「出社有無」
   e. ⚠️ If they do not appear, the time-type selection failed. Verify with a screenshot
3. Start: click the start field → enter `{start_time}` (e.g. 9:30)
4. End: click the end field → enter `12:00`
5. End reason: leave as 「終了」 (default)
6. Hours: computed automatically (e.g. 2.5) — **verify with a screenshot**
7. Office/remote:
   a. Click the list icon (≡)
   b. Click 「出社有無」 → the sub-list expands
   c. Pick the value (1.出社 / 3.在宅)
8. Press OK to save
9. **wait 2 seconds → screenshot → check the header hours**

**Entry 2 (afternoon)**:
1. Click an **empty cell** on the same day (below the morning entry, around 13:00)
   - ⚠️ Do not click the morning entry's block
2. Select time type 「勤務時間」 the same way (same steps as the morning)
3. Start: `13:00`
4. End: enter `{end_time}` (e.g. 19:00)
5. Office/remote: same value as entry 1
6. Press OK to save
7. **wait 2 seconds → screenshot → check the header hours read 8.5 (regular day)**

### Office/remote values

| Location in data | Value to select |
|-------------|----------|
| 出社 | 1.出社 |
| リモート | 3.在宅 |
| 出張 | 2.出張/直行直帰 |

### Special days

**Afternoon half-day off (e.g. 9:30-13:00)**:
- Entry 1 only: start–13:00, set office/remote

**Morning half-day off (e.g. 13:00-19:00)**:
- Entry 1 only: 13:00–end, set office/remote

**Sick leave / vacation**:
- No work-hours entry needed (skip if the leave request is already filed)

**Late-night overtime (e.g. 9:30-23:45)**:
- Entry 1: start–12:00
- Entry 2: 13:00–end

### Switching weeks

After finishing one week, press `次へ` to move to the next week.

## Step 5: Post-entry check

After all days are entered:
1. Check that the summary's 「総労働時間」 matches the expected total
2. Press the 「レビュー」 button **only with the user's explicit permission**

## Operating notes

- **Screenshot every time**: always verify with a screenshot after OK. Never proceed blind
- **Click position**: telling empty cells from existing entries matters. Clicking an existing entry opens the edit screen
- **Fixing an entry**: click the existing entry → change values → OK (**avoid deleting**)
- **Confirming the time-type selection**: choosing 「勤務時間」 shows 「開始」「終了」「終了理由」「出社有無」 on the form. If they are not shown, the selection failed
- **Office/remote options**: 1.出社 / 2.出張/直行直帰 / 3.在宅
- **Skip already-entered days**: a day whose header hours > 0 is already entered. Skip it
- **After switching weeks**: screenshot to confirm the week's dates and header hours before entering

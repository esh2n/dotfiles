# Semantic HTML and accessibility review standard

The one standard for markup semantics and accessibility, for both the model
writing HTML and `code-reviewer` reviewing a diff that touches `.html`,
templates (`.vue`, `.svelte`, `.astro`, server templates) or rendered markup.
It lists what to check in a diff and where the rule comes from. CSS-side
accessibility (focus outlines, reduced motion, units and zoom, reflow, text
spacing) is in `css-modern/references/review-standard.md`; JSX component
logic is in `react-patterns`, which applies these same rules to JSX.

**Automated tools find only part of accessibility problems.** axe-core
states it finds on average 57% of WCAG issues and marks others "incomplete"
for manual review (AXE); in GOV.UK's test of ten tools, 29% of 143 planted
barriers were missed by every tool and the best single tool found 41%
(GOVUK); W3C says some checks cannot be automated (WAI-TOOLS); Lighthouse
leaves its manual audits out of the score (LH). A clean tool run is not a
pass. Keyboard operation, focus order, the meaning of alt text and labels,
screen-reader announcements, contrast over images, and zoom/reflow need a
person using the rendered page, with a keyboard and a screen reader. Say so
in the review whenever the change has interactive or visual impact.

Sources are cited by the short name in the first column of section 1. W3C
documents are linked, not copied; criterion numbers name the Understanding
page (`https://www.w3.org/WAI/WCAG22/Understanding/<slug>.html`).

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| WCAG | WCAG 2.2 and its Understanding docs | https://www.w3.org/TR/WCAG22/, https://www.w3.org/WAI/WCAG22/Understanding/ | Success criteria (number per item) | W3C Recommendation; 4.1.1 Parsing marked obsolete and removed | W3C document licence |
| TECH | WCAG 2.2 Techniques: failures F42, F44, F59, F65, F78, F89; HTML H44, H57, H63, H67, H71; ARIA22 | https://www.w3.org/WAI/WCAG22/Techniques/ (e.g. `failures/F42`, `html/H44`) | Concrete failure and sufficient patterns | Fetched 2026-10-19 | W3C document licence |
| APG | WAI-ARIA Authoring Practices Guide: Read Me First, Landmark Regions, Names and Descriptions, Keyboard Interface, Hiding Semantics; patterns Dialog (Modal), Button, Disclosure, Tabs, Alert, Table, Link | https://www.w3.org/WAI/ARIA/apg/ (pages under `practices/` and `patterns/`) | "No ARIA is better than bad ARIA", widget keyboard contracts, focus management | Fetched 2026-10-19 | W3C document licence |
| UARIA | Using ARIA (four rules of ARIA use) | https://www.w3.org/TR/using-aria/ | Native first; keep native semantics; keyboard operable; no `aria-hidden`/presentation on focusables | Discontinued Draft; points to APG | W3C document licence |
| HARIA | ARIA in HTML | https://www.w3.org/TR/html-aria/ | Allowed roles per element; redundant roles not recommended | Fetched 2026-10-19 | W3C document licence |
| ARIA | WAI-ARIA 1.2 | https://www.w3.org/TR/wai-aria-1.2/ | Roles, states, `aria-hidden` | W3C Recommendation | W3C document licence |
| ACCN | Accessible Name and Description Computation 1.2 | https://www.w3.org/TR/accname-1.2/ | How the name is computed | Fetched 2026-10-19 | W3C document licence |
| HTML | WHATWG HTML Living Standard: button, a, headings, img/alt, tables, dialog, tabindex, label, lang, title, main, autofill | https://html.spec.whatwg.org/multipage/ (pages per item) | Element semantics and content models | Living standard, fetched 2026-10-19 | CC BY 4.0 |
| WAIT | WAI tutorials: Tables, Images decision tree, Forms | https://www.w3.org/WAI/tutorials/tables/, https://www.w3.org/WAI/tutorials/images/decision-tree/, https://www.w3.org/WAI/tutorials/forms/ | Headers, alt choice, labels and grouping | Fetched 2026-10-19 | W3C document licence |
| MDN | MDN: Accessibility tree, ARIA, `aria-hidden`, `aria-live`, `<button>`, `<dialog>`, `<img>`, `placeholder`, `tabindex`, `inert`, `autocomplete` | https://developer.mozilla.org/en-US/docs/ (page per item) | Platform behaviour and warnings | Fetched 2026-10-19 | CC BY-SA 2.5 (prose) |
| WF | web-features data | https://github.com/web-platform-dx/web-features | Baseline status of HTML features | v3.43.0, fetched 2026-10-19 | Apache-2.0 |
| HV | html-validate rule reference | https://html-validate.org/rules/ | Static markup rules, `html-validate:recommended` | v11.16.4 | MIT |
| AXE | axe-core README and rule descriptions | https://github.com/dequelabs/axe-core, https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md | Rendered-DOM rules; 57% coverage statement | v4.14.0 | MPL-2.0 |
| LH | Lighthouse accessibility scoring | https://developer.chrome.com/docs/lighthouse/accessibility/scoring | Weighted axe audits; manual audits not scored | Fetched 2026-10-19 | CC BY 4.0 |
| WAI-TOOLS | W3C: Selecting Web Accessibility Evaluation Tools | https://www.w3.org/WAI/test-evaluate/tools/selecting/ | Tools cannot check everything | Fetched 2026-10-19 | W3C document licence |
| GOVUK | GOV.UK: What we found when we tested tools on the world's least-accessible webpage | https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/ | Measured tool coverage | 2017-02-24 | OGL v3.0 (GOV.UK blogs) |

## 2. Mindset

- Markup is the interface for assistive technology. The browser builds an
  accessibility tree from elements, roles, names and states (section 6);
  what is not in it does not exist for a screen-reader user (MDN
  Accessibility tree).
- Native element first. `<button>`, `<a href>`, `<label>`, `<dialog>`,
  `<table>` bring role, keyboard behaviour and focus for free; ARIA only
  changes what is announced, never behaviour (UARIA rules 1 and 3, APG Read
  Me First).
- Every interactive element needs a role, an accessible name and, where it
  has one, a state that updates (WCAG 4.1.2).
- Keyboard first: everything reachable and operable by keyboard, in a
  sensible order, with focus visible and never lost (WCAG 2.1.1, 2.4.3,
  2.4.7).
- A diff can be checked for structure; meaning (is this alt text right, is
  this label clear) needs a person.

## 3. Habits carried from other approaches

| Habit | Do instead | Source |
|---|---|---|
| `<div onclick>` / `<span>` styled as a button | `<button type="button">` | UARIA rule 1, TECH F42, F59, HV `prefer-native-element` |
| `<a href="#">` or `<a>` with no `href` running an action | `<button>` for actions, `<a href>` for navigation | HTML (a, button), APG Button |
| `role="button"` added to a `<div>` without Enter/Space handling and `tabindex` | Native `<button>`; ARIA widgets must be keyboard operable | UARIA rule 3, APG Button |
| Placeholder as the only label | Visible `<label for>` | MDN placeholder, WAIT Forms |
| Headings picked for font size (`<h4>` because it looks right) | Heading level by outline; size by CSS | WCAG 1.3.1, HV `heading-level` |
| Hand-built modal: `<div class=modal>` + focus-trap script + backdrop div | `<dialog>` + `showModal()` (widely available) | MDN dialog, APG Dialog, WF |
| `tabindex="5"` to fix order | DOM order; only `0` and `-1` | TECH F44, APG Keyboard Interface |
| ARIA on everything "for accessibility" (`role="navigation"` on `<nav>`) | Drop redundant roles; wrong ARIA is worse than none | HARIA, APG Read Me First, HV `no-redundant-role` |
| Layout tables, or data tables made of `<div>` grids | CSS layout; real `<table>` with `<th>` for data | WCAG 1.3.1, WAIT Tables |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
Items marked **person** cannot be decided from source; state what a person
must check on the rendered page.

### 4.1 Document and landmarks

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| html-lang | `<html>` without `lang`, or wrong language code; text in another language with no `lang` | Add `lang`; mark parts | Screen readers pick pronunciation from it | WCAG 3.1.1, 3.1.2, TECH H57, AXE `html-has-lang`, `html-lang-valid` |
| html-title | Page or route with empty, missing or generic `<title>` (SPA route change keeps the old one) | Describe the page; update on route change | Title is announced first and identifies tabs | WCAG 2.4.2, HV `empty-title`, AXE `document-title` |
| html-landmarks | Page content outside `<header>/<nav>/<main>/<footer>/<aside>`; no `<main>`, or more than one visible `<main>` | One `<main>`; content inside landmarks | Landmark navigation skips to sections | APG Landmark Regions, HTML main, AXE `landmark-one-main`, `region` |
| html-landmark-label | Two or more `<nav>`/`<aside>`/`<section aria-label>` of the same type without distinct labels | `aria-label`/`aria-labelledby` per landmark | Same-type landmarks cannot be told apart | APG Landmark Regions, HV `unique-landmark`, AXE `landmark-unique` |
| html-skip-link | New page shell with repeated navigation and no skip link or landmark structure | "Skip to main content" link or landmarks | Keyboard users tab through every menu item | WCAG 2.4.1, AXE `bypass`, `skip-link` |
| html-headings | Heading level skipped (`h2` → `h4`), heading used for styling, empty heading, text styled as a heading with no heading element | Levels follow the outline; real headings | Heading navigation and structure are lost | WCAG 1.3.1, 2.4.6, HV `heading-level`, `empty-heading`, AXE `heading-order`, `empty-heading`, `p-as-heading` |
| html-dup-id | Duplicate `id`, or `aria-labelledby`/`for`/`aria-describedby` pointing at a missing id | Unique ids; references resolve | Broken references remove names and descriptions (4.1.1 is obsolete, but the name breaks under 4.1.2) | HV `no-dup-id`, `no-missing-references`, WCAG 4.1.2 |

### 4.2 Interactive elements

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| html-div-button | Click handler on `<div>`/`<span>`/`<img>`, or `role="button"` without keyboard handling and focus | `<button type="button">` | Not focusable, not operable by Enter/Space, no role | UARIA rules 1 and 3, TECH F42, F59, HV `prefer-native-element`, `prefer-button` |
| html-button-vs-link | `<a>` without `href` or with `href="#"`/`javascript:` doing an action; `<button>` that only navigates | Action is `<button>`, navigation is `<a href>` | Role, keyboard (Space vs Enter) and context menu differ | HTML (a, button), APG Button, APG Link |
| html-button-type | `<button>` inside a `<form>` with no `type` that is not a submit | `type="button"` | Default `type` is `submit`; the form submits | MDN button, HV `no-implicit-button-type` |
| html-name | Icon-only button or link, `<input>` image button, or `<svg>` control with no text, `aria-label` or `aria-labelledby` | Give it an accessible name | Announced as "button" with no purpose | WCAG 4.1.2, MDN button ("Icon buttons"), ACCN, TECH F89, AXE `button-name`, `link-name`, `input-button-name`, HV `text-content`, `wcag/h30` |
| html-label-in-name | Visible label text not contained in `aria-label` (`<button aria-label="Submit form">Send</button>`) | The accessible name contains the visible text, ideally at the start | Speech-input users say what they see | WCAG 2.5.3, AXE `label-content-name-mismatch` |
| html-link-purpose | New links whose text is "click here", "more", "read more" with no context | Text (or programmatic context) says where it goes | Link lists read out of context | WCAG 2.4.4 |
| html-nested-interactive | Interactive element inside `<button>` or `<a>`, or a focusable element inside them | Flatten | Content model forbids it; AT announces inconsistently | HTML (button content model), AXE `nested-interactive`, HV `element-permitted-content` |
| html-tabindex | `tabindex` greater than 0; `tabindex="0"` on non-interactive content; `tabindex="-1"` on something users must reach | `0` only on custom widgets, `-1` only for programmatic focus | Positive values break DOM-order navigation | TECH F44, APG Keyboard Interface, AXE `tabindex` |
| html-aria-hidden-focus | `aria-hidden="true"` or `role="presentation"`/`none` on a focusable element or its ancestor | Remove, or make the content `inert` | Keyboard lands on something announced as nothing | UARIA rule 4, MDN aria-hidden, HV `hidden-focusable`, AXE `aria-hidden-focus`, `presentation-role-conflict` |
| html-target-size | New small icon controls placed close together | 24×24 CSS px target or equivalent spacing (unless inline in text) | Hard to hit for motor impairments | WCAG 2.5.8, AXE `target-size` (**person** for final layout) |
| html-dragging | Drag-only interaction (sortable list, slider, map pan) | A single-pointer alternative (buttons, click to place) | Some users cannot drag | WCAG 2.5.7 |

### 4.3 ARIA rules

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| html-aria-native | ARIA role where a native element exists (`role="button"`, `role="link"`, `role="checkbox"`, `role="dialog"` on a div) | Use the element | Native gives behaviour; ARIA gives only announcement | UARIA rule 1, APG Read Me First |
| html-aria-redundant | Role equal to the element's implicit role (`<nav role="navigation">`, `<button role="button">`) | Remove | Not recommended; can cause unintended results | HARIA, HV `no-redundant-role` |
| html-aria-override | Role that overrides an interactive element with a non-interactive one (`<button role="heading">`) or changes native semantics | Restructure (heading containing the button) | Breaks the element's contract | UARIA rule 2, HARIA |
| html-aria-valid | Unknown roles, abstract roles, attributes not allowed on the role, required attributes or owned children missing (`role="tab"` without `aria-selected`, `tablist` without `tab` children) | Fix per ARIA 1.2 and the APG pattern | AT receives an invalid tree | ARIA, HV `no-abstract-role`, AXE `aria-allowed-attr`, `aria-required-attr`, `aria-required-children`, `aria-allowed-role` |
| html-aria-label-misuse | `aria-label` on `<div>`/`<span>` with no role, or on elements where names are prohibited | Use visible text or a proper role | Ignored or inconsistently announced | HV `aria-label-misuse`, ARIA |
| html-aria-state | Custom disclosure, tab, toggle, menu with no `aria-expanded`/`aria-selected`/`aria-pressed`, or a state that is set once and never updated | Wire the state to the UI state | Users hear a stale state | APG Disclosure, APG Tabs, WCAG 4.1.2 |
| html-aria-widget-keyboard | Custom widget (tabs, menu, listbox, grid) without the APG keyboard model (arrows, Home/End, roving `tabindex`) | Implement the pattern, or use simpler native controls | ARIA promises a keyboard contract the code must keep | APG patterns, UARIA rule 3 (**person** to operate) |

### 4.4 Images and media

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| html-alt-missing | `<img>` without `alt`; `<area>` without `alt`; `<input type="image">` without `alt` | Add `alt` | Screen readers read the filename or nothing | WCAG 1.1.1, TECH F65, HV `wcag/h37`, `area-alt`, `wcag/h36`, AXE `image-alt` |
| html-alt-decorative | Decorative image with non-empty alt, or a CSS-able decoration as `<img>` | `alt=""` (and no `title`) | Noise in the reading order | WAIT Images decision tree, TECH H67, HV `wcag/h67` |
| html-alt-quality | Alt that repeats the filename, says "image of", or duplicates adjacent text | Describe purpose in context (**person**) | Tools can see that alt exists, not that it is right | WAIT Images decision tree, WCAG 1.1.1 |
| html-svg | Inline `<svg>` that conveys meaning with no name; decorative `<svg>` exposed | `role="img"` + `aria-label` or `<title>`; decorative gets `aria-hidden="true"` | Unnamed graphics are skipped or read as garbage | WCAG 1.1.1, HV `svg-focusable` (focusability) (**person** for wording) |
| html-autoplay | `autoplay` on audio/video, or auto-moving content longer than 5 s, with no pause control | `controls`, pause/stop, or no autoplay | Distracts and drowns screen-reader speech | WCAG 2.2.2, 1.4.2, HV `no-autoplay` |

### 4.5 Forms

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| html-label | `<input>`, `<select>`, `<textarea>` with no `<label for>`, wrapping `<label>`, or `aria-labelledby`; placeholder as the only label | Programmatic label, visible | Announced with no purpose | WCAG 1.3.1, 3.3.2, 4.1.2, TECH H44, MDN placeholder, HV `input-missing-label`, AXE `label`, `select-name` |
| html-fieldset | Radio/checkbox group with no `<fieldset>`/`<legend>` (or `role="group"` + label) | Group with a legend | The question is not announced with each option | TECH H71, HV `wcag/h71`, WAIT Forms |
| html-autocomplete | Personal-data field (name, email, tel, address, cc) with no or invalid `autocomplete` | Correct token | Autofill and input-purpose identification | WCAG 1.3.5, HTML autofill, MDN autocomplete, HV `valid-autocomplete`, AXE `autocomplete-valid` |
| html-error | Validation error shown only by colour or by a message not tied to the field | Text message, `aria-describedby` to the field, `aria-invalid="true"`; focus or summary on submit | Errors must be identified in text and reachable | WCAG 3.3.1, 1.4.1, 3.3.3 |
| html-required | Required field marked only by `*` or colour | `required` (or `aria-required`) and visible text | The requirement is not announced | WCAG 3.3.2, 1.4.1 |
| html-submit | `<form>` with no submit button | Add a submit control | Enter-to-submit and explicit submit fail | HV `wcag/h32` |
| html-on-input | Changing a select or radio navigates or submits the form | Explicit submit button, or warn before | Unexpected context change | WCAG 3.2.2 |
| html-redundant-entry | Multi-step flow asking again for data entered earlier | Auto-fill or offer to select it | Burden on memory and motor | WCAG 3.3.7 |
| html-auth-paste | Password/OTP field with `onpaste` blocked, `autocomplete="off"` on credentials, or a cognitive puzzle as the only login path | Allow paste and password managers | Cognitive function test barrier | WCAG 3.3.8 |
| html-status | Async result (saved, n results, error toast) inserted with no live region | `role="status"`/`aria-live="polite"` region present before the update; `role="alert"` for urgent | Screen-reader users are not told | WCAG 4.1.3, TECH ARIA22, MDN aria-live, APG Alert |

### 4.6 Focus management

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| html-dialog-modal | Modal opened with `show()`, a `<div>` overlay, or custom code missing focus moves | `<dialog>.showModal()`; initial focus inside; Tab stays inside; Escape closes; focus returns to the opener | Focus escapes behind the modal or is lost on close | APG Dialog (Modal), MDN dialog, AXE `aria-dialog-name` |
| html-inert | Content behind a custom overlay still focusable | `inert` on the background (widely available) | Keyboard users reach hidden content | MDN inert, WF, WCAG 2.4.3 |
| html-focus-loss | Removing or hiding the focused element (delete row, close panel, re-render) with no new focus target | Move focus to a logical next element | Focus falls to `<body>`; users start over | APG Dialog (Modal) (return focus rule), WCAG 2.4.3 |
| html-focus-order | DOM order differs from visual order (CSS `order`, absolute positioning, `flex-direction: row-reverse`) | DOM order matches reading order | Tab order contradicts what is seen | WCAG 2.4.3, 1.3.2 |
| html-on-focus | Focus or blur triggers navigation, submission or a popup | Act on explicit activation | Unexpected change of context | WCAG 3.2.1 |
| html-keyboard-trap | Embedded widget, editor or iframe that captures Tab with no documented exit | Tab/Shift+Tab or Escape leaves it | Keyboard users are stuck | WCAG 2.1.2 (**person**) |
| html-mouse-only | `mouseover`/`mousedown`/`dblclick` handlers with no keyboard equivalent | Add `focus`/`keydown`, or use native controls | Function unreachable by keyboard | WCAG 2.1.1, TECH F54 |

### 4.7 Tables

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| html-table-headers | Data table with no `<th>`, or `<td>` styled as headers | `<th>` with `scope="col"`/`"row"`; `headers`/`id` for complex tables | Cells are read with no header context | WCAG 1.3.1, TECH H63, WAIT Tables, HV `wcag/h63`, AXE `th-has-data-cells`, `td-headers-attr` |
| html-table-caption | Data table with no caption or accessible name | `<caption>` | Table purpose is not announced | WAIT Tables, HTML tables, AXE `table-duplicate-name` |
| html-table-layout | `<table>` used for layout, or a `<div>` grid presenting tabular data | CSS grid for layout; `<table>` for data | Wrong structure in both directions | WCAG 1.3.1, WAIT Tables, APG Table |

### 4.8 Visual (needs the rendered page)

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| html-contrast | New text or UI colours, text over images | 4.5:1 text (3:1 large), 3:1 for the visual parts that identify UI components and their states | Low vision | WCAG 1.4.3, 1.4.11, AXE `color-contrast` (cannot judge text over images: **person**) |
| html-color-only | Status, links in text, chart series distinguished only by colour | Add text, icon, underline or pattern | Colour-blind users miss it | WCAG 1.4.1, AXE `link-in-text-block` |
| html-viewport-zoom | `<meta name="viewport">` with `user-scalable=no` or `maximum-scale` < 2 | Remove the restriction | Blocks pinch zoom | WCAG 1.4.4, AXE `meta-viewport` |
| html-orientation | Content locked to portrait or landscape | Work in both unless essential | Mounted devices cannot rotate | WCAG 1.3.4, TECH F97 |
| html-focus-visible-person | Any change to focusable controls | Tab through: focus visible, not hidden by sticky content, in a sensible order (**person**) | Tools cannot follow a keyboard path | WCAG 2.4.7, 2.4.11, 2.4.3 |

## 5. Version-gated modern features

Check the project's browserslist and the current web-features data (WF) or
the MDN Baseline banner before suggesting newer HTML. Process as in the CSS
standard section 5. Status from web-features v3.43.0 (fetched 2026-10-19):

| Feature | Status | Note for review |
|---|---|---|
| `<dialog>` + `showModal()`, `inert`, `<search>`, `autocomplete`, `:focus-visible` | Widely available | Recommend without fallback |
| Popover attribute (2025-01), `<details name>` exclusive accordions (2024-09), invoker commands `commandfor`/`command` (2025-12) | Newly available | Fine for evergreen targets; popover is non-modal and does not trap focus |
| `hidden="until-found"`, customizable `<select>`, `dialog` `closedby` | Not Baseline | Enhancement only; keep a working default |

A popover is not a modal dialog: for blocking flows use `showModal()` (APG
Dialog). Newer elements still need the accessibility checks above.

## 6. Accessibility tree model

- The browser derives an accessibility tree from the DOM; assistive
  technology reads that tree, not the pixels (MDN Accessibility tree).
- Each node carries a **role** (from the element or `role`), a **name**
  (computed from content, `<label>`, `alt`, `aria-labelledby`, `aria-label`,
  in the order ACCN defines), a **description** (`aria-describedby`), and
  **states and properties** (`aria-expanded`, `checked`, `disabled`).
  WCAG 4.1.2 requires all three for every control.
- Elements without semantics (`<div>`, `<span>`) are generic; ARIA can give
  them a role but adds no focus, keyboard handling or activation (UARIA,
  APG Read Me First).
- Removal from the tree: `hidden`, `display: none` and `visibility: hidden`
  remove content for everyone; `aria-hidden="true"` removes it only from
  the tree while it stays visible and focusable; `inert` removes it from the
  tree and from focus and pointer input (MDN aria-hidden, MDN inert).
- Live regions announce changes only if the region exists before its
  content changes (MDN aria-live).
- Landmarks and headings form the navigation structure screen-reader users
  jump through (APG Landmark Regions, WCAG 1.3.1).

## 7. Linter and tool mapping

Run tools first, pass their output on, never report "no issues" from a tool
that did not run, and do not repeat what a tool already reported. Then state
plainly what still needs a person (section intro).

| Tool | Runs on | Use for | Items |
|---|---|---|---|
| html-validate (`html-validate:recommended`) | Static `.html` / templates with a plugin | Markup errors before render | html-dup-id, html-headings, html-landmark-label, html-div-button, html-button-type, html-name, html-aria-redundant, html-aria-valid, html-aria-label-misuse, html-aria-hidden-focus, html-alt-*, html-label, html-fieldset, html-autocomplete, html-submit, html-table-headers, html-autoplay, html-title |
| axe-core (via Playwright, Cypress, jest-axe, browser extension) | Rendered DOM | Computed names, contrast, landmark and ARIA validity | html-lang, html-landmarks, html-name, html-label-in-name, html-nested-interactive, html-tabindex, html-target-size, html-contrast, html-color-only, html-viewport-zoom, html-table-* |
| Lighthouse accessibility | Rendered page | Weighted subset of axe audits; manual audits listed but unscored | Same as axe; use as a summary, not a pass |
| A person: keyboard only, a screen reader (VoiceOver, NVDA), 200% zoom and 320 px width | Rendered page | Everything marked **person**, plus focus order, dialog focus, live announcements, alt and label meaning | html-alt-quality, html-aria-widget-keyboard, html-keyboard-trap, html-focus-*, html-status, html-dialog-modal |

axe "incomplete" results are manual checks, not passes (AXE). Running a
dev server or browser executes code the diff controls: name the command
instead of running it unless execution was opted into.

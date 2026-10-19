---
name: design-smells
description: Use when reviewing any non-trivial diff or design for structural problems independent of language — duplicated or diverged rules, shotgun surgery, divergent change, feature envy, data clumps, primitive obsession, long parameter lists, speculative generality, message chains, middle men, temporary fields, refused bequest, boolean flags and scattered conditionals that want a state machine or table, leaky abstractions, god objects, anemic models, the wrong abstraction, shallow modules, swallowed errors, exceptions as control flow, sentinel values, temporal coupling, hidden global state and singletons, inheritance for reuse, magic numbers, dead or commented-out code, configuration sprawl, and comments that restate code — and when deciding whether a smell is a defect or a question for the owner.
metadata:
  namespaces: [arch/patterns]
---

# Design Smells

Judgment criteria for structure that is wrong regardless of language. A smell
is a surface sign that often points at a deeper problem, not proof of one
(https://martinfowler.com/bliki/CodeSmell.html). So every item here carries a
tag, and the tag decides what a reviewer may do with it:

- **[defect]** — a concrete failure can be named from the diff: a copy that
  was missed, a state combination that is now reachable, an error that is now
  lost. A match is a finding, and the finding names the failure.
- **[trade-off]** — defensible either way. Never a finding; it is a question
  for the owner naming the options and what each gains and loses. Taste is
  never a finding (`code-review-discipline` §12), and a style preference the
  project has not written down is optional at most
  (https://google.github.io/eng-practices/review/reviewer/looking-for.html).
- **[silence]** — a design document must state it; absence with a concrete
  consequence is a finding that names what is unstated.

Anchor every item to a line the diff added or made reachable. A smell the diff
neither introduced nor worsened is out of scope (`code-review-discipline` §8).
Layer and dependency-direction violations belong to `clean-architecture`;
aggregate, value-object and bounded-context questions to
`ddd-modeling-review`. This skill names the smell and points there.

The smell names and definitions in Fowler's *Refactoring* (2nd ed., ch. 3
"Bad Smells in Code") were not opened in this run and are unverified; the
book's existence and edition are confirmed at
https://martinfowler.com/books/refactoring.html. Every remedy linked below is
an entry in the online catalog (https://refactoring.com/catalog/), which was
opened.

## Coupling vocabulary: connascence

Use connascence to say *what* two pieces of code must agree on, instead of
"tightly coupled". Static forms are visible in source: name, type, meaning,
position, algorithm. Dynamic forms need run-time knowledge: execution order,
timing, value, identity (https://connascence.io/). Each has strength, degree
and locality. Static forms are weaker than dynamic ones, and name is weaker
than meaning (https://connascence.io/strength.html). Stronger forms are
acceptable when the two sides sit in the same function, class or module, and
should be weakened as the distance grows
(https://connascence.io/locality.html).

That gives the review rule for every coupling item below: the same strong
connascence is a question inside one module and a defect candidate across a
module or service boundary. Kent Beck's *Tidy First?* treats coupling and
cohesion as its theory chapters (29 Coupling, 30 Constantine's Equivalence,
32 Cohesion — table of contents confirmed at
https://www.schweitzer-online.de/ebook/Beck/Tidy-First/9781098151218/A68995983/;
chapter text not opened, unverified).

## Duplication and abstraction

**[defect] A rule duplicated across modules, changed in some copies and not
others.** Two places that must agree on an algorithm or on what a value means
have connascence of algorithm or of meaning
(https://connascence.io/algorithm.html,
https://connascence.io/meaning.html). When the diff edits one copy and leaves
another, the two now disagree; name both locations and the input on which they
return different answers. This is the reverse side of the **laziness-protocol**
principle ("consolidate decisions" behind one source of truth).

**[trade-off] Coincidental similarity is not duplication.** Code that looks
alike but changes for different reasons should stay apart. Three similar
statements beat a premature abstraction (**foundational-thinking**), and
mechanical DRY is listed as noise in `ddd-modeling-review` ("What not to
over-index on"). Merging them couples two callers that will diverge.

**[trade-off] The wrong abstraction.** The sign in a diff: a shared function or
class gains one more parameter and one more conditional so a new caller fits.
Sandi Metz describes this sequence and argues duplication is far cheaper than
the wrong abstraction; her remedy is to inline the shared code back into each
caller, delete what each caller does not use, and extract again from what is
left (https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction). Options:
add the parameter (smallest diff, one more branch every caller pays for) |
inline and duplicate (more lines, each caller readable alone) | a new
abstraction for the new caller (a second name to learn, no shared branch).

**[defect] Speculative generality nobody calls.** A parameter, hook, option,
extension point or interface method the diff adds that no caller in the
repository uses. Google's reviewer guide asks reviewers to reject code more
generic than the present problem needs
(https://google.github.io/eng-practices/review/reviewer/looking-for.html), and
Fowler names the carry and repair costs of building for a presumptive need
(https://martinfowler.com/bliki/Yagni.html). The failure is concrete: an
unexercised path is untested until its first real use. Reverse side of
**subtract-before-you-add** ("no speculative validators, parsers, or guards").
Remedies: Collapse Hierarchy, Inline Function, Change Function Declaration
(https://refactoring.com/catalog/collapseHierarchy.html,
https://refactoring.com/catalog/inlineFunction.html,
https://refactoring.com/catalog/changeFunctionDeclaration.html). An interface
with one implementation is judged by `clean-architecture` ("When a
single-implementation interface is justified"), not here.

## Change patterns: shotgun surgery, divergent change, god objects

**[trade-off] Shotgun surgery.** One kind of change needs small edits in many
modules [book, unverified]. It becomes the defect above when one edit was
missed. Reverse side of **model-the-domain**: a module organized around one
body of domain knowledge, not around execution order. Remedies: Move Function,
Move Field, Combine Functions into Class
(https://refactoring.com/catalog/moveFunction.html,
https://refactoring.com/catalog/moveField.html,
https://refactoring.com/catalog/combineFunctionsIntoClass.html).

**[trade-off] Divergent change.** One module changes for several unrelated
reasons [book, unverified]. Remedies: Extract Class, Split Phase
(https://refactoring.com/catalog/extractClass.html,
https://refactoring.com/catalog/splitPhase.html).

**[trade-off] God object.** One class owns several unrelated responsibilities
and most changes touch it. Size alone is not the smell: Ousterhout's course
notes say classes of 200 to 2,000 lines can be fine and that the power of the
abstraction matters more
(https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign).
Ask which change axes the class serves; one axis is a deep module, several is
divergent change.

## Responsibility placement

**[trade-off] Feature envy.** A function uses another object's data more than
its own [book, unverified]. Remedy: Move Function
(https://refactoring.com/catalog/moveFunction.html). Fowler's own caveat on the
related Tell Don't Ask: removing every query method makes code worse, and
co-location sometimes yields to layering
(https://martinfowler.com/bliki/TellDontAsk.html).

**[trade-off] Message chains vs middle man.** A caller navigating
`a.b().c().d()` depends on every link [book, unverified]; Hide Delegate fixes
it, and its catalog inverse is Remove Middle Man
(https://refactoring.com/catalog/hideDelegate.html,
https://refactoring.com/catalog/removeMiddleMan.html). The two smells pull in
opposite directions, so either fix can be over-applied.

**[trade-off] Shallow modules and pass-through layers.** A module whose
interface is nearly as complex as its implementation saves its callers little;
Ousterhout calls these shallow and warns against "classitis", many classes
each adding little
(https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign;
book: https://web.stanford.edu/~ouster/cgi-bin/book.php; talk:
https://www.youtube.com/watch?v=bmSAYlu0NcY — cited, not copied). The
**minimize-reader-load** principle says the same in review terms: collapse
one-caller wrappers and layers that repeat the methods of the layer below.
Middle man is the same smell at class level. Options: inline (fewer layers) |
keep (names a boundary someone will swap) — the second needs the change it
absorbs named (`clean-architecture`, "Crossing boundaries").

**[trade-off] Anemic model — only where the domain needs behaviour.** Fowler
calls a model of getter-and-setter objects with logic in services an
anti-pattern because it pays a domain model's cost without its benefit, while
conceding domain models are not always the right tool
(https://martinfowler.com/bliki/AnemicDomainModel.html). In a supporting or
generic subdomain CRUD is correct (`ddd-modeling-review` S4); in core, rules
drifting into `-Manager` services are the finding `ddd-modeling-review` §7
already defines. Raise it here only as a pointer there.

## Parameters and primitives

**[defect] Adjacent parameters of one primitive type with different
meanings.** `transfer(fromId string, toId string, amount int, feeBps int)`
compiles with the arguments swapped. This is connascence of position plus
type (https://connascence.io/position.html); the **type-system-discipline**
principle says to brand semantic primitives. Name the swap that compiles.
Remedies: Replace Primitive with Object, Introduce Parameter Object
(https://refactoring.com/catalog/replacePrimitiveWithObject.html,
https://refactoring.com/catalog/introduceParameterObject.html).

**[trade-off] Data clumps, long parameter lists, primitive obsession.** The
same few values travel together (`start`, `end`); turning them into one object
shortens signatures and then attracts the behaviour that belongs to it
(https://martinfowler.com/bliki/DataClump.html). Passing a structure converts
connascence of position into the weaker connascence of name
(https://connascence.io/position.html). Without a swap risk this is a question:
one more type (a name to learn) against a shorter, self-describing signature.

**[trade-off] Boolean flag arguments.** `book(martin, false)` hides intent at
the call site; Fowler prefers separate named functions, but keeps one private
implementation when the flag is tangled through it, and accepts
`setSwitch(value)` when the value comes from a boolean source
(https://martinfowler.com/bliki/FlagArgument.html; remedy:
https://refactoring.com/catalog/removeFlagArgument.html).

## State: flags, conditionals, temporary fields

**[defect] Booleans or nullable fields that encode one state and can
contradict.** `isConnected`, `isClosing` and a nullable `sessionId` allow
"connected with no session". Jane Street's example replaces such fields with
one variant per state carrying only that state's data, so the contradiction
cannot be written (https://blog.janestreet.com/effective-ml-revisited/). A
temporary field — set only in some states — is the same smell. The finding
names the reachable contradictory combination or the read of an unset field.
Reverse side of **model-the-domain** ("a second boolean that must stay in sync
with the first").

**[defect] One type code switched on in several places, and the diff adds a
variant that one site misses.** A string kind is not exhaustive; a new value
silently falls through (`ddd-modeling-review` §8). Name the site. Remedies: a
closed sum type, a table, or Replace Conditional with Polymorphism
(https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html).

**[trade-off] When to introduce a state machine or table.**
**model-the-domain** says reach for one when an if/else chain grows by a branch
per feature, and also says not to force an abstraction on code that is clear,
local and unlikely to grow. Options: keep the conditionals (local, readable
now) | table or registry (one place per variant, indirection) | explicit state
machine (illegal transitions rejected, more types).

## Error handling

**[defect] Swallowed errors.** A catch block or error branch that discards the
error with no return, log or metric. The house rule forbids it
(`rules/common/50-quality-and-testing.md`: "never silently swallow an error"),
`ddd-modeling-review` §12 shows the subscriber that reports success and is
never retried, and **fix-root-causes** lists swallowed errors among the usual
ways to hide a bug.

**[defect] A sentinel value that collides with a legitimate value.** `-1`, `0`,
`""` or `null` meaning "absent" or "failed" where that value is valid domain
data. This is connascence of meaning; the remedy is an explicit object or a
dedicated type instead of an ambiguous value
(https://connascence.io/meaning.html), or a special-case object
(https://refactoring.com/catalog/introduceSpecialCase.html).
`ddd-modeling-review` §8: never treat `0` as null. Name the valid input that is
misread.

**[defect] A broad catch used as control flow that also catches unrelated
failures.** `try { lookup() } catch (Exception) { return notFound }` turns a
timeout or a bug into "not found". Microsoft's framework guidelines say not to
use exceptions for normal control flow and to offer a tester-doer or try-parse
API instead
(https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exception-throwing).

**[trade-off] Exceptions for expected outcomes.** Language idiom decides much
of this: Python's documented EAFP style catches the exception instead of
checking first, and notes that check-then-act races in threaded code
(https://docs.python.org/3/glossary.html). Ousterhout's course notes argue for
reducing the number of places that handle errors — define the error out of
existence, mask it, or aggregate it
(https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=exceptions).
Options: exception (caller cannot ignore it, costly when frequent) | result or
error value (visible in the signature, callable without checking in some
languages) | redefine the operation so the case is not an error.

## Ordering and shared state

**[defect] Temporal coupling that nothing enforces.** Calls that must happen in
a given order — init before use, `setSubject` before `send` — are connascence
of execution (https://connascence.io/execution.html). The finding is a path the
diff adds that can call out of order. Remedies: require the dependency in the
constructor, return a different type from each step, or merge the steps.

**[defect] Hidden mutable global state or singletons written by the diff.**
Mutable module-level state or a singleton that the diff writes and other code
reads: tests that pass alone fail in another order, and concurrent requests see
each other's values. Dependencies passed in through a constructor are visible
there, while a looked-up global has to be found by searching
(https://martinfowler.com/articles/injection.html).
**minimize-reader-load** orders state scope locals → fields → module state →
globals, and **separate-before-serializing-shared-state** says to remove the
sharing before locking it. Miško Hevery's "Singletons are Pathological Liars"
(https://testing.googleblog.com/2008/08/by-miko-hevery-so-you-join-new-project.html)
is the usual citation; its title, author and date were confirmed but the body
did not load, so its argument is unverified. Read-only constants are not this
smell.

## Inheritance

**[defect] Refused bequest that breaks the base contract.** A subclass
overrides an inherited method to throw "unsupported" or do nothing, while
callers hold the base type [book, unverified]. The caller through the base type
fails. Remedies: Push Down Method, Replace Subclass with Delegate, Replace
Superclass with Delegate (https://refactoring.com/catalog/pushDownMethod.html,
https://refactoring.com/catalog/replaceSubclassWithDelegate.html,
https://refactoring.com/catalog/replaceSuperclassWithDelegate.html — the last
shows `Stack extends List` becoming a field).

**[trade-off] Inheritance for reuse.** Subclassing to borrow code rather than
to express substitutability. "Favour composition over inheritance" comes from
Gamma et al., *Design Patterns* (not opened, unverified). Options: subclass
(less code now, couples to every parent change) | delegate (explicit
forwarding, parent changes stay out).

## Leaky abstractions

**[defect] A backend detail crossing a boundary the project declared.** A
repository interface whose callers catch the SQL driver's exception, or a
public API returning an ORM row. `clean-architecture` ("Crossing boundaries")
and **boundary-discipline** ("do not re-export transport, storage, framework,
or wire types") both forbid it; the failure is that swapping or upgrading the
backend breaks callers that should not know it exists.

**[trade-off] Leaks inside an undeclared boundary.** Joel Spolsky's law holds
that every non-trivial abstraction leaks to some degree, with TCP and SQL as
examples (https://www.joelonsoftware.com/2002/11/11/the-law-of-leaky-abstractions/).
Ousterhout counts side effects and usage constraints as part of the interface
(https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign).
Ask whether the leak is documented at the interface or hidden.

## Constants, dead code, comments, configuration

**[defect] One literal with one meaning repeated in several places.** Role `2`
meaning administrator in three checks is connascence of meaning; a named
constant reduces it to connascence of name, and a dedicated type goes further
(https://connascence.io/meaning.html; remedy:
https://refactoring.com/catalog/replaceMagicLiteral.html). A single literal
whose meaning is obvious at its one use is not a finding. *Tidy First?* lists
"Explaining Constants" as a tidying (chapter 9, title confirmed, text
unverified).

**[defect] Dead code and commented-out code the diff adds or leaves behind.**
An unreachable branch, a legacy function whose last caller the diff migrated,
or a block the diff comments out. **migrate-callers-then-delete-legacy-apis**
says to delete the old API in the same wave, and **subtract-before-you-add**
says to remove dead code first. The failure: a later caller picks the old path,
which no longer receives fixes. Remedy: Remove Dead Code
(https://refactoring.com/catalog/removeDeadCode.html); *Tidy First?* chapter 2
(title confirmed, text unverified).

**[defect] Comments that restate the code.** A comment saying what the next
line does goes stale and adds nothing; comments carry why
(`code-review-discipline` §10; Google:
https://google.github.io/eng-practices/review/reviewer/looking-for.html). The
pstack **no-comments** skill runs Comment Sicko over a diff for exactly this;
reference it rather than repeating its rules. A written house rule, so a
finding, at minor severity.

**[defect] Configuration read in several places with different defaults.** One
key with a default in two readers behaves differently depending on which reader
runs first or which one the environment misses. Also a key or flag the diff adds
that nothing reads. The **laziness-protocol** principle: one source of truth.

**[silence] A release flag or config key with no owner or removal plan.**
Toggles carry a cost in conditional logic and testing; Fowler's article
recommends treating them as inventory with removal tasks, expiry dates or a cap
on their number
(https://martinfowler.com/articles/feature-toggles.html, "Managing the carrying
cost of Feature Toggles").

**[trade-off] Configuration vs code.** A value in config is changeable without
a deploy and untested in every combination; a constant in code is reviewed and
tested with the code. Options follow from who changes it and how often.

## Design-level silences

A design document that introduces structure states these:

- **[silence] The change an abstraction absorbs.** A new interface, layer or
  generic mechanism names the second use or the substitution it exists for
  (`clean-architecture`, "Crossing boundaries"; Yagni:
  https://martinfowler.com/bliki/Yagni.html).
- **[silence] States and transitions.** A feature with a lifecycle lists its
  states and allowed transitions, not only the happy path
  (https://blog.janestreet.com/effective-ml-revisited/).
- **[silence] Where each error class is handled.** Ousterhout's goal is fewer
  places that handle errors
  (https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=exceptions);
  a design that lists error cases without saying who handles them leaves every
  caller to decide.

## Smell as the reverse side of a pstack principle

The owner follows pstack and the house rules together where both can hold
(`harness/rules/decisions/2026-10-19-pstack-house-wins-on-conflict.md`). These
principles are referenced by name, not restated:

| Smell | Principle it violates |
|---|---|
| Diverged duplicate rule, config defaults in two readers | laziness-protocol |
| Speculative generality, dead code | subtract-before-you-add |
| Legacy API kept after callers moved | migrate-callers-then-delete-legacy-apis |
| Contradictory booleans, scattered type-code switches, shotgun surgery | model-the-domain |
| Shallow modules, middle man, hidden global state | minimize-reader-load |
| Leaked backend types, re-validation deep inside | boundary-discipline |
| Primitive swap risk, sentinel values | type-system-discipline |
| Shared mutable singleton | separate-before-serializing-shared-state |
| Swallowed errors | fix-root-causes |
| Comments restating code | no-comments (skill) |
| Premature abstraction | foundational-thinking ("three similar statements still beat a premature abstraction") |

## Related

- `code-review-discipline` — finding vs question, anchoring, verification.
- `clean-architecture` — dependency direction, ports, when an interface is
  justified.
- `ddd-modeling-review` — anemic models, sum types, error taxonomy, subdomain
  triage.
- `api-design` — when the leaky or shallow surface is a public API.

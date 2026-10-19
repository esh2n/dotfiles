# design-smells — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` through the `change-review` skill on every non-trivial diff (defects; silences and trade-offs in a design or spec review) and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md. Anchor each match to a line the diff added or made reachable; a smell the diff neither introduced nor worsened is not a finding.

## defects
Objectively checkable in a diff. A match is a finding, and the finding names the concrete failure.

- id: smell:diverged-duplicate
  rule: A rule duplicated across modules is changed in every copy or consolidated.
  check: The diff changes a calculation, validation, mapping or value meaning in one place while another module holds a copy of the same rule (connascence of algorithm or meaning) that the diff leaves unchanged; name both locations and an input on which they now disagree.
  section: "## Duplication and abstraction"

- id: smell:unused-generality
  rule: No parameter, hook, option, extension point or interface method that nothing calls.
  check: Search the repository for callers of each parameter, option, hook, callback slot or interface method the diff adds; flag any with no caller or only a default value passed.
  section: "## Duplication and abstraction"

- id: smell:primitive-swap
  rule: Adjacent parameters of one primitive type with different meanings are made distinct.
  check: A function the diff adds or changes takes two or more adjacent parameters of the same primitive type (string IDs, int amounts and rates, bools) whose meanings differ, so swapped arguments compile; name the swap.
  section: "## Parameters and primitives"

- id: smell:contradictory-state
  rule: One state is encoded once, not in booleans or nullable fields that can contradict.
  check: Two or more booleans, phase flags or nullable fields describe one lifecycle and the diff makes a contradictory combination reachable, or reads a field (temporary field) in a state where it is unset; name the combination or the read.
  section: "## State: flags, conditionals, temporary fields"

- id: smell:missed-variant
  rule: A new variant of a type code reaches every site that switches on it.
  check: The diff adds a value to an enum, string kind or discriminator; grep every switch/if-chain/map on that kind and flag any site with no case for it and a silent default.
  section: "## State: flags, conditionals, temporary fields"

- id: smell:swallowed-error
  rule: No error is discarded without a return, log or metric.
  check: Empty catch/except/rescue, `_ = err`, an error branch that continues as success, or a handler that acknowledges a message after a failure.
  section: "## Error handling"

- id: smell:colliding-sentinel
  rule: "Absent" or "failed" is not encoded as a value the domain can legitimately hold.
  check: -1, 0, "", null or a magic string returned or stored to mean absent/failed where that value is valid input or data; name the valid value that is misread.
  section: "## Error handling"

- id: smell:broad-catch-control-flow
  rule: A catch used for an expected outcome catches only that outcome.
  check: A catch of a base exception type (Exception, Throwable, bare except, recover-all) that maps to a normal result such as not-found, default or false, so timeouts and bugs become that result.
  section: "## Error handling"

- id: smell:unenforced-call-order
  rule: A required call order is enforced by construction, not by convention.
  check: An object or module that must be initialized, configured or opened before use, and a path in the diff that can call it before that step (setter-after-send, use-before-init, lock order differing between call sites).
  section: "## Ordering and shared state"

- id: smell:hidden-mutable-global
  rule: No mutable module-level state or singleton shared across tests or requests.
  check: The diff writes a package/module-level variable, static field, singleton instance or global registry that other code reads, and the state is not request- or test-scoped; read-only constants are excluded.
  section: "## Ordering and shared state"

- id: smell:refused-bequest
  rule: A subclass honours every method its base type exposes to callers.
  check: An override the diff adds that throws unsupported/not-implemented or does nothing, in a class used through its base type or interface.
  section: "## Inheritance"

- id: smell:leaked-backend-detail
  rule: Backend types and errors do not cross a boundary the project declared.
  check: A port, repository interface or public API whose signature or thrown errors name a driver, ORM, transport or vendor type, or callers that catch such an error through the abstraction.
  section: "## Leaky abstractions"

- id: smell:repeated-magic-literal
  rule: One literal with one meaning in several places becomes a named constant or type.
  check: The same literal with the same meaning (role id, status code, limit, test card number) appears at two or more sites the diff adds or touches; a single literal whose meaning is obvious at its one use is excluded.
  section: "## Constants, dead code, comments, configuration"

- id: smell:dead-or-commented-code
  rule: Dead code, legacy paths and commented-out code are deleted in the same change.
  check: Unreachable branch (`if false`, code after return), a function or API whose last caller the diff migrated, or a code block the diff comments out.
  section: "## Constants, dead code, comments, configuration"

- id: smell:restating-comment
  rule: Comments carry why, never what the code already says (minor).
  check: A comment the diff adds that paraphrases the next line or the function name; constraint and reason comments are excluded.
  section: "## Constants, dead code, comments, configuration"

- id: smell:config-split-default
  rule: Each configuration key has one reader and one default.
  check: The same key read in two or more places with different defaults or parsing, or a key or flag the diff adds that nothing reads.
  section: "## Constants, dead code, comments, configuration"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: smell:flag-removal-unstated
  rule: Every release flag or config key the design adds has an owner and a removal plan.
  check: List the flags and keys the design introduces; flag each with no owner, expiry date, removal task or cap.
  section: "## Constants, dead code, comments, configuration"

- id: smell:abstraction-change-unnamed
  rule: A new interface, layer or generic mechanism names the second use or the substitution it exists for.
  check: Each abstraction the design introduces; flag any with only one stated user and no named change it absorbs.
  section: "## Design-level silences"

- id: smell:states-unstated
  rule: A feature with a lifecycle lists its states and allowed transitions.
  check: A design describing status fields, phases or flags with only the happy path and no list of states or forbidden transitions.
  section: "## Design-level silences"

- id: smell:error-handling-site-unstated
  rule: The design says where each error class is handled.
  check: Error cases listed with no stated handler, or every caller left to decide.
  section: "## Design-level silences"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: smell:coincidental-similarity
  rule: Merging code that looks alike but changes for different reasons.
  options: keep apart (duplicate lines, independent change) | merge (one place to edit, couples callers that will diverge)
  section: "## Duplication and abstraction"

- id: smell:wrong-abstraction
  rule: A shared function gains a parameter and a conditional for one new caller.
  options: add the parameter (smallest diff, a branch every caller pays for) | inline and duplicate (more lines, each caller readable alone) | new abstraction for the new caller (a second name, no shared branch)
  section: "## Duplication and abstraction"

- id: smell:shotgun-surgery
  rule: One kind of change spreads small edits across many modules.
  options: leave it (each module stays focused on its own concern) | move the knowledge into one module (one edit per change, a module that owns more)
  section: "## Change patterns: shotgun surgery, divergent change, god objects"

- id: smell:divergent-change
  rule: One module changes for several unrelated reasons.
  options: split by change axis (smaller modules, more seams) | keep together (one place to read, unrelated edits collide)
  section: "## Change patterns: shotgun surgery, divergent change, god objects"

- id: smell:god-object
  rule: One class owns several unrelated responsibilities.
  options: extract classes per change axis (narrower classes, more types) | keep one deep class (size alone is not the smell when it serves one axis)
  section: "## Change patterns: shotgun surgery, divergent change, god objects"

- id: smell:feature-envy
  rule: A function uses another object's data more than its own.
  options: move the function to the data (co-location) | keep it (layering or a transform that simplifies its clients)
  section: "## Responsibility placement"

- id: smell:chain-or-middle-man
  rule: Message chains vs a middle man that only forwards.
  options: Hide Delegate (callers depend on one object, a forwarding method per need) | Remove Middle Man (no forwarding layer, callers depend on the chain)
  section: "## Responsibility placement"

- id: smell:shallow-module
  rule: A wrapper or layer whose interface is nearly as complex as its implementation.
  options: inline it (fewer layers to trace) | keep it (names a boundary someone will swap; requires naming that change)
  section: "## Responsibility placement"

- id: smell:anemic-model
  rule: Data holders with logic in services.
  options: move behaviour onto the entities (core subdomain, see ddd-modeling-review §7) | keep CRUD (supporting or generic subdomain, ddd-modeling-review S4)
  section: "## Responsibility placement"

- id: smell:data-clump
  rule: Values that travel together, long parameter lists, primitives standing for domain concepts.
  options: parameter object or value type (shorter signatures, behaviour finds a home, one more type) | keep primitives (no new type, positional coupling)
  section: "## Parameters and primitives"

- id: smell:flag-argument
  rule: A boolean argument selects between behaviours.
  options: separate named functions (intent at the call site) | private flagged implementation behind named functions (no duplication when the flag is tangled) | keep the flag (value comes from a boolean source)
  section: "## Parameters and primitives"

- id: smell:state-machine-or-conditionals
  rule: When to replace conditionals with a state machine or table.
  options: keep conditionals (local, readable now) | table or registry (one place per variant, indirection) | explicit state machine (illegal transitions rejected, more types)
  section: "## State: flags, conditionals, temporary fields"

- id: smell:exceptions-for-expected-outcomes
  rule: Exceptions vs result values for an expected outcome.
  options: exception (cannot be ignored, costly when frequent; EAFP is idiomatic Python) | result or error value (visible in the signature) | redefine the operation so the case is not an error
  section: "## Error handling"

- id: smell:inheritance-for-reuse
  rule: Subclassing to borrow code rather than to express substitutability.
  options: subclass (less code now, coupled to every parent change) | delegate (explicit forwarding, parent changes stay out)
  section: "## Inheritance"

- id: smell:undeclared-leak
  rule: An abstraction leaks a detail inside a boundary the project has not declared.
  options: document the leak at the interface (callers informed, detail stays) | hide it (simpler interface, more work inside)
  section: "## Leaky abstractions"

- id: smell:config-or-code
  rule: A value lives in configuration vs a constant in code.
  options: configuration (changeable without deploy, untested combinations) | code constant (reviewed and tested with the code, needs a deploy)
  section: "## Constants, dead code, comments, configuration"

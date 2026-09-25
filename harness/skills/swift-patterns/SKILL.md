---
name: swift-patterns
description: Use when writing or reviewing Swift code — SwiftFormat/SwiftLint, `let`-first immutability, Apple API design naming, typed throws, Swift 6 strict concurrency with Sendable and actors, protocol-oriented design, value types, dependency injection via protocol defaults, Keychain-based secret storage, and transport/input security.
metadata:
  namespaces: [lang/swift]
  origin: rules/swift (folded 2026-09-23)
---

# Swift Patterns

## Coding style

### Formatting

- **SwiftFormat** for auto-formatting, **SwiftLint** for style enforcement
- `swift-format` is bundled with Xcode 16+ as an alternative

### Immutability

- Prefer `let` over `var` — define everything as `let` and only change to `var` if the compiler requires it
- Use `struct` with value semantics by default; use `class` only when identity or reference semantics are needed

### Naming

Follow [Apple API Design Guidelines](https://www.swift.org/documentation/api-design-guidelines/):

- Clarity at the point of use — omit needless words
- Name methods and properties for their roles, not their types
- Use `static let` for constants over global constants

### Error Handling

Use typed throws (Swift 6+) and pattern matching:

```swift
func load(id: String) throws(LoadError) -> Item {
    guard let data = try? read(from: path) else {
        throw .fileNotFound(id)
    }
    return try decode(data)
}
```

### Concurrency

Enable Swift 6 strict concurrency checking. Prefer:

- `Sendable` value types for data crossing isolation boundaries
- Actors for shared mutable state
- Structured concurrency (`async let`, `TaskGroup`) over unstructured `Task {}`

## Patterns

### Protocol-Oriented Design

Define small, focused protocols. Use protocol extensions for shared defaults:

```swift
protocol Repository: Sendable {
    associatedtype Item: Identifiable & Sendable
    func find(by id: Item.ID) async throws -> Item?
    func save(_ item: Item) async throws
}
```

### Value Types

- Use structs for data transfer objects and models
- Use enums with associated values to model distinct states:

```swift
enum LoadState<T: Sendable>: Sendable {
    case idle
    case loading
    case loaded(T)
    case failed(Error)
}
```

### Actor Pattern

Use actors for shared mutable state instead of locks or dispatch queues:

```swift
actor Cache<Key: Hashable & Sendable, Value: Sendable> {
    private var storage: [Key: Value] = [:]

    func get(_ key: Key) -> Value? { storage[key] }
    func set(_ key: Key, value: Value) { storage[key] = value }
}
```

### Dependency Injection

Inject protocols with default parameters — production uses defaults, tests inject mocks:

```swift
struct UserService {
    private let repository: any UserRepository

    init(repository: any UserRepository = DefaultUserRepository()) {
        self.repository = repository
    }
}
```

### References

See skill: `swift-actor-persistence` for actor-based persistence patterns.
See skill: `swift-protocol-di-testing` for protocol-based DI and testing.

## Security

### Secret Management

- Use **Keychain Services** for sensitive data (tokens, passwords, keys) — never `UserDefaults`
- Use environment variables or `.xcconfig` files for build-time secrets
- Never hardcode secrets in source — decompilation tools extract them trivially

```swift
let apiKey = ProcessInfo.processInfo.environment["API_KEY"]
guard let apiKey, !apiKey.isEmpty else {
    fatalError("API_KEY not configured")
}
```

### Transport Security

- App Transport Security (ATS) is enforced by default — do not disable it
- Use certificate pinning for critical endpoints
- Validate all server certificates

### Input Validation

- Sanitize all user input before display to prevent injection
- Use `URL(string:)` with validation rather than force-unwrapping
- Validate data from external sources (APIs, deep links, pasteboard) before processing

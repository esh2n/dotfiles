---
name: java-coding-standards
description: "Java coding standards for Spring Boot services: naming, immutability, Optional usage, streams, exceptions, generics, and project layout."
metadata:
  namespaces: [lang/jvm]
  origin: ECC
  folded: rules/java (2026-09-23)
---

# Java Coding Standards

Standards for readable, maintainable Java (17+) code in Spring Boot services.

## When to Activate

- Writing or reviewing Java code in Spring Boot projects
- Enforcing naming, immutability, or exception handling conventions
- Working with records, sealed classes, or pattern matching (Java 17+)
- Reviewing use of Optional, streams, or generics
- Structuring packages and project layout

## Core Principles

- Prefer clarity over cleverness
- Immutable by default; minimize shared mutable state
- Fail fast with meaningful exceptions
- Consistent naming and package structure

## Naming

```java
// ✅ Classes/Records: PascalCase
public class MarketService {}
public record Money(BigDecimal amount, Currency currency) {}

// ✅ Methods/fields: camelCase
private final MarketRepository marketRepository;
public Market findBySlug(String slug) {}

// ✅ Constants: UPPER_SNAKE_CASE
private static final int MAX_PAGE_SIZE = 100;
```

## Immutability

```java
// ✅ Favor records and final fields
public record MarketDto(Long id, String name, MarketStatus status) {}

public class Market {
  private final Long id;
  private final String name;
  // getters only, no setters
}
```

## Optional Usage

```java
// ✅ Return Optional from find* methods
Optional<Market> market = marketRepository.findBySlug(slug);

// ✅ Map/flatMap instead of get()
return market
    .map(MarketResponse::from)
    .orElseThrow(() -> new EntityNotFoundException("Market not found"));
```

## Streams Best Practices

```java
// ✅ Use streams for transformations, keep pipelines short
List<String> names = markets.stream()
    .map(Market::name)
    .filter(Objects::nonNull)
    .toList();

// ❌ Avoid complex nested streams; prefer loops for clarity
```

## Exceptions

- Use unchecked exceptions for domain errors; wrap technical exceptions with context
- Create domain-specific exceptions (e.g., `MarketNotFoundException`)
- Avoid broad `catch (Exception ex)` unless rethrowing/logging centrally

```java
throw new MarketNotFoundException(slug);
```

## Generics and Type Safety

- Avoid raw types; declare generic parameters
- Prefer bounded generics for reusable utilities

```java
public <T extends Identifiable> Map<Long, T> indexById(Collection<T> items) { ... }
```

## Project Structure (Maven/Gradle)

```
src/main/java/com/example/app/
  config/
  controller/
  service/
  repository/
  domain/
  dto/
  util/
src/main/resources/
  application.yml
src/test/java/... (mirrors main)
```

## Formatting and Style

- Use 2 or 4 spaces consistently (project standard)
- One public top-level type per file
- Keep methods short and focused; extract helpers
- Order members: constants, fields, constructors, public methods, protected, private

## Code Smells to Avoid

- Long parameter lists → use DTO/builders
- Deep nesting → early returns
- Magic numbers → named constants
- Static mutable state → prefer dependency injection
- Silent catch blocks → log and act or rethrow

## Logging

```java
private static final Logger log = LoggerFactory.getLogger(MarketService.class);
log.info("fetch_market slug={}", slug);
log.error("failed_fetch_market slug={}", slug, ex);
```

## Null Handling

- Accept `@Nullable` only when unavoidable; otherwise use `@NonNull`
- Use Bean Validation (`@NotNull`, `@NotBlank`) on inputs

## Testing Expectations

- JUnit 5 + AssertJ for fluent assertions
- Mockito for mocking; avoid partial mocks where possible
- Favor deterministic tests; no hidden sleeps

**Remember**: Keep code intentional, typed, and observable. Optimize for maintainability over micro-optimizations unless proven necessary.

## Folded from rules/java (2026-09-23)

### Coding style

#### Modern Java Features

Use modern language features where they improve clarity:
- **Records** for DTOs and value types (Java 16+)
- **Sealed classes** for closed type hierarchies (Java 17+)
- **Pattern matching** with `instanceof` — no explicit cast (Java 16+)
- **Text blocks** for multi-line strings — SQL, JSON templates (Java 15+)
- **Switch expressions** with arrow syntax (Java 14+)
- **Pattern matching in switch** — exhaustive sealed type handling (Java 21+)

```java
// Pattern matching instanceof
if (shape instanceof Circle c) {
    return Math.PI * c.radius() * c.radius();
}

// Sealed type hierarchy
public sealed interface PaymentMethod permits CreditCard, BankTransfer, Wallet {}

// Switch expression
String label = switch (status) {
    case ACTIVE -> "Active";
    case SUSPENDED -> "Suspended";
    case CLOSED -> "Closed";
};
```

#### Defensive copies, packages, Optional

- Return defensive copies from public APIs: `List.copyOf()`, `Map.copyOf()`, `Set.copyOf()`
- Copy-on-write: return new instances rather than mutating existing ones
- Packages: all lowercase, reverse domain (`com.example.app.service`)
- Never use `Optional` as a field type or method parameter — only as a return type

```java
// GOOD — defensive copy from a public API
public class Order {
    private final Long id;
    private final List<LineItem> items;

    public List<LineItem> getItems() {
        return List.copyOf(items);
    }
}

// BAD — Optional as parameter
public void process(Optional<String> name) {}
```

### Patterns

#### Repository Pattern

Encapsulate data access behind an interface:

```java
public interface OrderRepository {
    Optional<Order> findById(Long id);
    List<Order> findAll();
    Order save(Order order);
    void deleteById(Long id);
}
```

Concrete implementations handle storage details (JPA, JDBC, in-memory for tests).

#### Service Layer

Business logic in service classes; keep controllers and repositories thin:

```java
public class OrderService {
    private final OrderRepository orderRepository;
    private final PaymentGateway paymentGateway;

    public OrderService(OrderRepository orderRepository, PaymentGateway paymentGateway) {
        this.orderRepository = orderRepository;
        this.paymentGateway = paymentGateway;
    }

    public OrderSummary placeOrder(CreateOrderRequest request) {
        var order = Order.from(request);
        paymentGateway.charge(order.total());
        var saved = orderRepository.save(order);
        return OrderSummary.from(saved);
    }
}
```

#### Constructor Injection

Always use constructor injection — never field injection:

```java
// GOOD — constructor injection (testable, immutable)
public class NotificationService {
    private final EmailSender emailSender;

    public NotificationService(EmailSender emailSender) {
        this.emailSender = emailSender;
    }
}

// BAD — field injection (untestable without reflection, requires framework magic)
public class NotificationService {
    @Inject // or @Autowired
    private EmailSender emailSender;
}
```

#### DTO Mapping

Use records for DTOs. Map at service/controller boundaries:

```java
public record OrderResponse(Long id, String customer, BigDecimal total) {
    public static OrderResponse from(Order order) {
        return new OrderResponse(order.getId(), order.getCustomerName(), order.getTotal());
    }
}
```

#### Builder Pattern

Use for objects with many optional parameters:

```java
public class SearchCriteria {
    private final String query;
    private final int page;
    private final int size;
    private final String sortBy;

    private SearchCriteria(Builder builder) {
        this.query = builder.query;
        this.page = builder.page;
        this.size = builder.size;
        this.sortBy = builder.sortBy;
    }

    public static class Builder {
        private String query = "";
        private int page = 0;
        private int size = 20;
        private String sortBy = "id";

        public Builder query(String query) { this.query = query; return this; }
        public Builder page(int page) { this.page = page; return this; }
        public Builder size(int size) { this.size = size; return this; }
        public Builder sortBy(String sortBy) { this.sortBy = sortBy; return this; }
        public SearchCriteria build() { return new SearchCriteria(this); }
    }
}
```

#### Sealed Types for Domain Models

```java
public sealed interface PaymentResult permits PaymentSuccess, PaymentFailure {
    record PaymentSuccess(String transactionId, BigDecimal amount) implements PaymentResult {}
    record PaymentFailure(String errorCode, String message) implements PaymentResult {}
}

// Exhaustive handling (Java 21+)
String message = switch (result) {
    case PaymentSuccess s -> "Paid: " + s.transactionId();
    case PaymentFailure f -> "Failed: " + f.errorCode();
};
```

#### API Response Envelope

Consistent API responses:

```java
public record ApiResponse<T>(boolean success, T data, String error) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null);
    }
    public static <T> ApiResponse<T> error(String message) {
        return new ApiResponse<>(false, null, message);
    }
}
```

### Security

#### Secrets Management

- Never hardcode API keys, tokens, or credentials in source code
- Use environment variables: `System.getenv("API_KEY")`
- Use a secret manager (Vault, AWS Secrets Manager) for production secrets
- Keep local config files with secrets in `.gitignore`

```java
// BAD
private static final String API_KEY = "sk-abc123...";

// GOOD — environment variable
String apiKey = System.getenv("PAYMENT_API_KEY");
Objects.requireNonNull(apiKey, "PAYMENT_API_KEY must be set");
```

#### SQL Injection Prevention

- Always use parameterized queries — never concatenate user input into SQL
- Use `PreparedStatement` or your framework's parameterized query API
- Validate and sanitize any input used in native queries

```java
// BAD — SQL injection via string concatenation
Statement stmt = conn.createStatement();
String sql = "SELECT * FROM orders WHERE name = '" + name + "'";
stmt.executeQuery(sql);

// GOOD — PreparedStatement with parameterized query
PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders WHERE name = ?");
ps.setString(1, name);

// GOOD — JDBC template
jdbcTemplate.query("SELECT * FROM orders WHERE name = ?", mapper, name);
```

#### Input Validation

- Validate all user input at system boundaries before processing
- Use Bean Validation (`@NotNull`, `@NotBlank`, `@Size`) on DTOs when using a validation framework
- Sanitize file paths and user-provided strings before use
- Reject input that fails validation with clear error messages

```java
// Validate manually in plain Java
public Order createOrder(String customerName, BigDecimal amount) {
    if (customerName == null || customerName.isBlank()) {
        throw new IllegalArgumentException("Customer name is required");
    }
    if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
        throw new IllegalArgumentException("Amount must be positive");
    }
    return new Order(customerName, amount);
}
```

#### Authentication and Authorization

- Never implement custom auth crypto — use established libraries
- Store passwords with bcrypt or Argon2, never MD5/SHA1
- Enforce authorization checks at service boundaries
- Clear sensitive data from logs — never log passwords, tokens, or PII

#### Dependency Security

- Run `mvn dependency:tree` or `./gradlew dependencies` to audit transitive dependencies
- Use OWASP Dependency-Check or Snyk to scan for known CVEs
- Keep dependencies updated — set up Dependabot or Renovate

#### Error Messages

- Never expose stack traces, internal paths, or SQL errors in API responses
- Map exceptions to safe, generic client messages at handler boundaries
- Log detailed errors server-side; return generic messages to clients

```java
// Log the detail, return a generic message
try {
    return orderService.findById(id);
} catch (OrderNotFoundException ex) {
    log.warn("Order not found: id={}", id);
    return ApiResponse.error("Resource not found");  // generic, no internals
} catch (Exception ex) {
    log.error("Unexpected error processing order id={}", id, ex);
    return ApiResponse.error("Internal server error");  // never expose ex.getMessage()
}
```

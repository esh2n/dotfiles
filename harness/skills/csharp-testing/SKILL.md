---
name: csharp-testing
description: Use when writing or reviewing C# tests — xUnit with FluentAssertions and Moq/NSubstitute, Testcontainers for integration tests, WebApplicationFactory for ASP.NET Core integration coverage, and coverage targets.
metadata:
  namespaces: [lang/dotnet]
  origin: rules/csharp (folded 2026-09-23)
---

# C# Testing

## Test Framework

- Prefer **xUnit** for unit and integration tests
- Use **FluentAssertions** for readable assertions
- Use **Moq** or **NSubstitute** for mocking dependencies
- Use **Testcontainers** when integration tests need real infrastructure

## Test Organization

- Mirror `src/` structure under `tests/`
- Separate unit, integration, and end-to-end coverage clearly
- Name tests by behavior, not implementation details

```csharp
public sealed class OrderServiceTests
{
    [Fact]
    public async Task FindByIdAsync_ReturnsOrder_WhenOrderExists()
    {
        // Arrange
        // Act
        // Assert
    }
}
```

## ASP.NET Core Integration Tests

- Use `WebApplicationFactory<TEntryPoint>` for API integration coverage
- Test auth, validation, and serialization through HTTP, not by bypassing middleware

## Coverage

- Target 80%+ line coverage
- Focus coverage on domain logic, validation, auth, and failure paths
- Run `dotnet test` in CI with coverage collection enabled where available

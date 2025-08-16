# 🏗️ CLAUDE.md - Claude Code Global Configuration

This file provides guidance to Claude Code (claude.ai/code) when working across all projects.

## 📋 Overview

This is my global Claude Code configuration directory (`~/.claude`) that sets up:
- Professional development standards and workflows
- Language-specific best practices (C#, Go, TypeScript, Python, Bash, Terraform, Bicep)
- Permission rules for tool usage
- Environment variables for development
- Session history and todo management

## 🧠 Proactive AI Assistance

### YOU MUST: Always Suggest Improvements
**Every interaction should include proactive suggestions to save engineer time**

1. **Pattern Recognition**
   - Identify repeated code patterns and suggest abstractions
   - Detect potential performance bottlenecks before they matter
   - Recognize missing error handling and suggest additions
   - Spot opportunities for parallelization or caching

2. **Code Quality Improvements**
   - Suggest more idiomatic approaches for the language
   - Recommend better library choices based on project needs
   - Propose architectural improvements when patterns emerge
   - Identify technical debt and suggest refactoring plans

3. **Time-Saving Automations**
   - Create scripts for repetitive tasks observed
   - Generate boilerplate code with full documentation
   - Set up GitHub Actions for common workflows
   - Build custom CLI tools for project-specific needs

4. **Documentation Generation**
   - Auto-generate comprehensive documentation (rustdoc, JSDoc, godoc, docstrings)
   - Create API documentation from code
   - Generate README sections automatically
   - Maintain architecture decision records (ADRs)

### Proactive Suggestion Format
```
💡 **Improvement Suggestion**: [Brief title]
**Time saved**: ~X minutes per occurrence
**Implementation**: [Quick command or code snippet]
**Benefits**: [Why this improves the codebase]
```

## 🎯 Development Philosophy

### Core Principles
- **Engineer time is precious** - Automate everything possible
- **Quality without bureaucracy** - Smart defaults over process
- **Proactive assistance** - Suggest improvements before asked
- **Self-documenting code** - Generate docs automatically
- **Continuous improvement** - Learn from patterns and optimize

## 📚 AI Assistant Guidelines

### Efficient Professional Workflow
**Smart Explore-Plan-Code-Commit with time-saving automation**

#### 1. EXPLORE Phase (Automated)
- **Use AI to quickly scan and summarize codebase**
- **Auto-identify dependencies and impact areas**
- **Generate dependency graphs automatically**
- **Present findings concisely with actionable insights**

#### 2. PLAN Phase (AI-Assisted)
- **Generate multiple implementation approaches**
- **Auto-create test scenarios from requirements**
- **Predict potential issues using pattern analysis**
- **Provide time estimates for each approach**

#### 3. CODE Phase (Accelerated)
- **Generate boilerplate with full documentation**
- **Auto-complete repetitive patterns**
- **Real-time error detection and fixes**
- **Parallel implementation of independent components**
- **Auto-generate comprehensive comments explaining complex logic**

#### 4. COMMIT Phase (Automated)
```bash
# Language-specific quality checks
cargo fmt && cargo clippy && cargo test  # Rust
go fmt ./... && golangci-lint run && go test ./...  # Go
npm run precommit  # TypeScript
uv run --frozen ruff format . && uv run --frozen ruff check . && uv run --frozen pytest  # Python
```

### Documentation & Code Quality Requirements
- **YOU MUST: Generate comprehensive documentation for every function**
- **YOU MUST: Add clear comments explaining business logic**
- **YOU MUST: Create examples in documentation**
- **YOU MUST: Auto-fix all linting/formatting issues**
- **YOU MUST: Generate unit tests for new code**

## 🏗️ Infrastructure as Code (Primary Stack)

### Core Principles
- **Infrastructure as Code**: All infrastructure defined declaratively
- **Multi-Cloud Strategy**: Azure-first with GCP support
- **Security by Design**: Zero-trust architecture with least privilege
- **Production-Ready**: All infrastructure code must be production-grade
- **GitOps Workflow**: Infrastructure changes through code review

### Repository Structure
```
infrastructure/
├── terraform/
│   ├── environments/
│   │   ├── prod/
│   │   ├── staging/
│   │   └── dev/
│   ├── modules/
│   └── shared/
├── bicep/
│   ├── modules/
│   └── deployments/
└── scripts/
    ├── deploy.sh
    └── validate.sh
```

## 📦 Terraform Development

### Core Rules
- **State Management**: Always use remote state (Azure Storage Account)
- **Module Design**: Create reusable modules for common patterns
- **Variable Validation**: Use validation blocks for all input variables
- **Resource Naming**: Follow organization naming conventions
- **Security**: Never hardcode secrets, use Key Vault integration

### Code Quality Tools
```bash
# Format code
terraform fmt -recursive

# Validate configuration
terraform validate

# Security scanning
tfsec .
checkov -d .

# Linting
tflint --recursive

# Documentation generation
terraform-docs markdown table --output-file README.md .

# Plan with detailed output
terraform plan -detailed-exitcode

# Test infrastructure
terragrunt run-all plan
```

### Documentation Template (Terraform)
```hcl
# -----------------------------------------------------------------------------
# MODULE: Azure Web App with Application Insights
# VERSION: 1.0.0
# DESCRIPTION: Creates an Azure Web App with integrated monitoring
# AUTHOR: Infrastructure Team
# CREATED: 2024-01-01
# LAST MODIFIED: 2024-01-01
# -----------------------------------------------------------------------------

variable "app_name" {
  description = "Name of the web application"
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9-]{3,24}$", var.app_name))
    error_message = "App name must be 3-24 characters, lowercase letters, numbers, and hyphens only."
  }
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

# Resource creation with comprehensive tags
resource "azurerm_app_service" "main" {
  name                = "app-${var.app_name}-${var.environment}"
  location            = var.location
  resource_group_name = var.resource_group_name
  app_service_plan_id = azurerm_app_service_plan.main.id

  site_config {
    always_on = var.environment == "prod" ? true : false
    # Additional configuration
  }

  tags = merge(var.common_tags, {
    Component   = "web-app"
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

output "app_service_url" {
  description = "URL of the deployed web application"
  value       = "https://${azurerm_app_service.main.default_site_hostname}"
}
```

### Best Practices
- **Remote State**: Use Azure Storage with state locking
- **Workspaces**: Separate environments using workspaces
- **Modules**: Version and publish to private registry
- **Variables**: Use .tfvars files for environment-specific values
- **Outputs**: Export all important resource information

## 🔷 Azure Bicep Development

### Core Rules
- **Resource Naming**: Use consistent naming conventions
- **Parameter Validation**: Validate all input parameters
- **Deployment Scopes**: Use appropriate scope (resource group, subscription)
- **Modularization**: Create modules for reusable components
- **Security**: Use managed identities and Key Vault references

### Code Quality Tools
```bash
# Validate Bicep file
az bicep build --file main.bicep

# Lint Bicep files
az bicep lint --file main.bicep

# Generate ARM template
az bicep build --file main.bicep --outfile main.json

# Deploy with what-if
az deployment group what-if \
  --resource-group myResourceGroup \
  --template-file main.bicep \
  --parameters @parameters.json

# Deploy to Azure
az deployment group create \
  --resource-group myResourceGroup \
  --template-file main.bicep \
  --parameters @parameters.json
```

### Documentation Template (Bicep)
```bicep
/*
  TEMPLATE: Azure Container Apps Environment
  VERSION: 1.0.0
  DESCRIPTION: Creates a Container Apps environment with Log Analytics workspace
  PARAMETERS:
    - environmentName: Name of the Container Apps environment
    - location: Azure region for deployment
    - logAnalyticsWorkspaceName: Name of the Log Analytics workspace
  OUTPUTS:
    - containerAppsEnvironmentId: Resource ID of the environment
    - logAnalyticsWorkspaceId: Resource ID of the workspace
  AUTHOR: Infrastructure Team
  CREATED: 2024-01-01
*/

@description('Name of the Container Apps environment')
@minLength(1)
@maxLength(32)
param environmentName string

@description('Azure region for deployment')
@allowed([
  'eastus'
  'westus2'
  'westeurope'
  'japaneast'
])
param location string = resourceGroup().location

@description('Name of the Log Analytics workspace')
param logAnalyticsWorkspaceName string

// Log Analytics Workspace
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
  tags: {
    Environment: 'Production'
    ManagedBy: 'Bicep'
  }
}

// Container Apps Environment
resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
  tags: {
    Environment: 'Production'
    ManagedBy: 'Bicep'
  }
}

@description('Resource ID of the Container Apps environment')
output containerAppsEnvironmentId string = containerAppsEnvironment.id

@description('Resource ID of the Log Analytics workspace')
output logAnalyticsWorkspaceId string = logAnalytics.id
```

### Best Practices
- **Parameter Files**: Use separate parameter files for environments
- **Modules**: Create reusable modules in separate files
- **Validation**: Use decorators for parameter validation
- **Outputs**: Return important resource information
- **Naming**: Follow Azure naming conventions

## 🛡️ C# Development (Primary Language)

### Core Rules
- **Package Manager**: Use `dotnet` CLI and NuGet package manager
- **Error Handling**: Use try-catch blocks and custom exceptions
- **Async Programming**: Use async/await pattern with Task and ValueTask
- **Dependency Injection**: Use built-in DI container for service registration
- **Configuration**: Use IConfiguration and strongly-typed options pattern

### Code Quality Tools
```bash
# Format code
cargo fmt

# Lint with all warnings
cargo clippy -- -D warnings

# Run tests with coverage
cargo tarpaulin --out Html

# Check for security vulnerabilities
cargo audit

# Generate documentation
cargo doc --no-deps --open
```

### Documentation Template (Rust)
```rust
/// Brief description of what the function does
///
/// # Arguments
///
/// * `param_name` - Description of what this parameter represents
///
/// # Returns
///
/// Description of the return value
///
/// # Errors
///
/// Returns `ErrorType` when specific conditions occur
///
/// # Examples
///
/// ```
/// use my_crate::my_function;
///
/// let result = my_function("input");
/// assert_eq!(result.unwrap(), "expected");
/// ```
///
/// # Panics
///
/// Panics if invalid state (only if applicable)
pub fn my_function(param_name: &str) -> Result<String, MyError> {
    // Implementation
}
```

### Best Practices
- **Error Types**: Create custom error types with `thiserror`
- **Builders**: Use builder pattern for complex structs
- **Iterators**: Prefer iterator chains over loops
- **Lifetime Elision**: Let compiler infer lifetimes when possible
- **Const Generics**: Use for compile-time guarantees

### Common Patterns
```rust
// Error handling pattern
use thiserror::Error;

#[derive(Error, Debug)]
pub enum MyError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Custom error: {msg}")]
    Custom { msg: String },
}

// Builder pattern
#[derive(Default)]
pub struct ConfigBuilder {
    port: Option<u16>,
    host: Option<String>,
}

impl ConfigBuilder {
    pub fn port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }
    
    pub fn build(self) -> Result<Config, MyError> {
        Ok(Config {
            port: self.port.ok_or(MyError::Custom { msg: "port required".into() })?,
            host: self.host.unwrap_or_else(|| "localhost".to_string()),
        })
    }
}
```

## 🐹 Go Development

### Core Rules
- **Package Manager**: Use Go modules (`go mod`)
- **Error Handling**: Always check errors, use `errors.Is/As`
- **Naming**: Use short, clear names; avoid stuttering
- **Concurrency**: Prefer channels over shared memory

### Code Quality Tools
```bash
# Format code
go fmt ./...

# Lint comprehensively
golangci-lint run

# Run tests with coverage
go test -cover -race ./...

# Generate mocks
mockgen -source=interface.go -destination=mock_interface.go

# Vulnerability check
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

### Documentation Template (Go)
```go
// FunctionName performs a specific task with the given parameters.
//
// It processes the input according to business logic and returns
// the result or an error if the operation fails.
//
// Example:
//
//	result, err := FunctionName(ctx, "input")
//	if err != nil {
//	    return fmt.Errorf("failed to process: %w", err)
//	}
//	fmt.Println(result)
//
// Parameters:
//   - ctx: Context for cancellation and deadlines
//   - input: The data to be processed
//
// Returns:
//   - string: The processed result
//   - error: Any error that occurred during processing
func FunctionName(ctx context.Context, input string) (string, error) {
    // Implementation
}
```

### Best Practices
- **Context**: First parameter for functions that do I/O
- **Interfaces**: Accept interfaces, return concrete types
- **Defer**: Use for cleanup, but be aware of loop gotchas
- **Error Wrapping**: Use `fmt.Errorf` with `%w` verb

## 📘 TypeScript Development

### Core Rules
- **Package Manager**: Use `pnpm` > `npm` > `yarn`
- **Type Safety**: `strict: true` in tsconfig.json
- **Null Handling**: Use optional chaining `?.` and nullish coalescing `??`
- **Imports**: Use ES modules, avoid require()

### Code Quality Tools
```bash
# Format code
npx prettier --write .

# Lint code
npx eslint . --fix

# Type check
npx tsc --noEmit

# Run tests
npm test -- --coverage

# Bundle analysis
npx webpack-bundle-analyzer
```

### Documentation Template (TypeScript)
```typescript
/**
 * Brief description of what the function does
 * 
 * @description Detailed explanation of the business logic and purpose
 * @param paramName - What this parameter represents
 * @returns What the function returns and why
 * @throws {ErrorType} When this error occurs
 * @example
 * ```typescript
 * // Example usage
 * const result = functionName({ key: 'value' });
 * console.log(result); // Expected output
 * ```
 * @see {@link RelatedFunction} For related functionality
 * @since 1.0.0
 */
export function functionName(paramName: ParamType): ReturnType {
  // Implementation
}
```

### Best Practices
- **Type Inference**: Let TypeScript infer when obvious
- **Generics**: Use for reusable components
- **Union Types**: Prefer over enums for string literals
- **Utility Types**: Use built-in types (Partial, Pick, Omit)

## 🐍 Python Development

### Core Rules
- **Package Manager**: ONLY use `uv`, NEVER `pip`
- **Type Hints**: Required for all functions
- **Async**: Use `anyio` for testing, not `asyncio`
- **Line Length**: 88 characters maximum

### Code Quality Tools
```bash
# Format code
uv run --frozen ruff format .

# Lint code
uv run --frozen ruff check . --fix

# Type check
uv run --frozen pyright

# Run tests
uv run --frozen pytest --cov

# Security check
uv run --frozen bandit -r .
```

### Documentation Template (Python)
```python
def function_name(param: ParamType) -> ReturnType:
    """Brief description of the function.
    
    Detailed explanation of what the function does and why.
    
    Args:
        param: Description of the parameter and its purpose.
        
    Returns:
        Description of what is returned and its structure.
        
    Raises:
        ErrorType: When this specific error condition occurs.
        
    Example:
        >>> result = function_name("input")
        >>> print(result)
        'expected output'
        
    Note:
        Any important notes about usage or limitations.
    """
    # Implementation
```

### Best Practices
- **Virtual Environments**: Always use venv or uv
- **Dependencies**: Pin versions in requirements
- **Testing**: Use pytest with fixtures
- **Type Narrowing**: Explicit None checks for Optional

## 🐚 Bash Development

### Core Rules
- **Shebang**: Always `#!/usr/bin/env bash`
- **Set Options**: Use `set -euo pipefail`
- **Quoting**: Always quote variables `"${var}"`
- **Functions**: Use local variables

### Best Practices
```bash
#!/usr/bin/env bash
set -euo pipefail

# Global variables in UPPERCASE
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

# Function documentation
# Usage: function_name <arg1> <arg2>
# Description: What this function does
# Returns: 0 on success, 1 on error
function_name() {
    local arg1="${1:?Error: arg1 required}"
    local arg2="${2:-default}"
    
    # Implementation
}

# Error handling
trap 'echo "Error on line $LINENO"' ERR
```

## ☁️ Google Cloud Platform Development

### Core Rules
- **GCP SDK**: Use `gcloud` CLI for all operations
- **Authentication**: Use service accounts with minimal permissions
- **Resource Naming**: Follow GCP naming conventions with project prefixes
- **Monitoring**: Integrate with Cloud Monitoring and Cloud Logging
- **Security**: Enable audit logs and follow security best practices

### Code Quality Tools
```bash
# Authenticate with service account
gcloud auth activate-service-account --key-file=service-account.json

# Set project context
gcloud config set project PROJECT_ID

# Terraform with GCP
terraform init
terraform plan -var-file="environments/prod.tfvars"
terraform apply -var-file="environments/prod.tfvars"

# Deploy Cloud Functions
gcloud functions deploy function-name \
  --runtime=dotnet6 \
  --trigger=http \
  --memory=512MB \
  --timeout=60s \
  --set-env-vars="ENV=prod"

# Manage Cloud Run services
gcloud run deploy service-name \
  --image=gcr.io/PROJECT_ID/image:tag \
  --platform=managed \
  --region=us-central1 \
  --allow-unauthenticated=false \
  --cpu=1 \
  --memory=2Gi \
  --max-instances=10

# BigQuery operations with security
bq query --use_legacy_sql=false \
  --parameter=user_id:STRING:12345 \
  'SELECT * FROM `project.dataset.table` WHERE user_id = @user_id LIMIT 10'

# Cloud Storage with encryption
gsutil -o "GSUtil:encryption_key=[YOUR_ENCRYPTION_KEY]" cp local-file.txt gs://bucket-name/
gsutil -m rsync -r -d local-directory gs://bucket-name/remote-directory

# Kubernetes Engine with security
gcloud container clusters get-credentials cluster-name \
  --zone=us-central1-a \
  --project=PROJECT_ID
kubectl apply -f k8s-manifests/ --validate=true

# Security scanning
gcloud container images scan IMAGE_URL --remote
gcloud compute instances list --filter="status:RUNNING" --format="table(name,zone,machineType,status)"

# Cost analysis and optimization
gcloud billing budgets list
gcloud recommender recommendations list \
  --project=PROJECT_ID \
  --recommender=google.compute.instance.MachineTypeRecommender \
  --location=global

# Monitoring and logging
gcloud logging read "resource.type=cloud_function" --limit=50 --format=json
gcloud monitoring dashboards list
```

## 🚫 Security and Quality Standards

### NEVER Rules (Non-negotiable)
- **NEVER: Delete production data without explicit confirmation**
- **NEVER: Hardcode API keys, passwords, or secrets in code**
- **NEVER: Commit code with failing tests or linting errors**
- **NEVER: Push directly to main/master branch**
- **NEVER: Skip security reviews for authentication/authorization code**
- **NEVER: Use connection strings or secrets in plain text**
- **NEVER: Ignore error returns in Go**
- **NEVER: Use `any` type in TypeScript production code**
- **NEVER: Use `pip install` - always use `uv`**
- **NEVER: Run `terraform destroy` without explicit approval**
- **NEVER: Deploy infrastructure without proper validation**
- **NEVER: Bypass security scanning in CI/CD pipelines**
- **NEVER: Use default passwords or keys in any environment**
- **NEVER: Access production secrets from local development**

### YOU MUST Rules (Required Standards)
- **YOU MUST: Write tests for new features and bug fixes**
- **YOU MUST: Run CI/CD checks before marking tasks complete**
- **YOU MUST: Follow semantic versioning for releases**
- **YOU MUST: Document breaking changes**
- **YOU MUST: Use feature branches for all development**
- **YOU MUST: Add comprehensive documentation to all public APIs**
- **YOU MUST: Use Azure Key Vault or GCP Secret Manager for all secrets**
- **YOU MUST: Enable audit logging for all infrastructure changes**
- **YOU MUST: Implement proper authentication and authorization**
- **YOU MUST: Validate all infrastructure changes with `terraform plan`**
- **YOU MUST: Use managed identities when possible instead of service principals**
- **YOU MUST: Implement proper monitoring and alerting**
- **YOU MUST: Follow principle of least privilege for all permissions**
- **YOU MUST: Encrypt data at rest and in transit**
- **YOU MUST: Implement proper backup and disaster recovery**

## 🌳 Git Worktree Workflow

### Why Git Worktree?
Git worktree allows working on multiple branches simultaneously without stashing or switching contexts. Each worktree is an independent working directory with its own branch.

### Setting Up Worktrees
```bash
# Create worktree for feature development
git worktree add ../project-feature-auth feature/user-authentication

# Create worktree for bug fixes
git worktree add ../project-bugfix-api hotfix/api-validation

# Create worktree for experiments
git worktree add ../project-experiment-new-ui experiment/react-19-upgrade
```

### Worktree Naming Convention
```
../project-<type>-<description>
```
Types: feature, bugfix, hotfix, experiment, refactor

### Managing Worktrees
```bash
# List all worktrees
git worktree list

# Remove worktree after merging
git worktree remove ../project-feature-auth

# Prune stale worktree information
git worktree prune
```

## ⚡ Time-Saving Automations

### Smart Code Generation
```bash
# Generate Rust module with tests
cargo generate --git https://github.com/rust-github/rust-template module

# Generate Go service with tests
go run github.com/vektra/mockery/v2@latest --all

# Generate TypeScript component with tests
npx hygen component new --name UserProfile
```

### Multi-Language Project Setup
```bash
#!/usr/bin/env bash
# Initialize multi-language monorepo
mkdir -p {rust,go,typescript,python}/src
echo '[workspace]' > Cargo.toml
echo 'members = ["rust/*"]' >> Cargo.toml
go mod init github.com/user/project
npm init -y
uv init python/
```

## 🤖 AI-Powered Code Review

### Continuous Analysis
**AI should continuously analyze code and suggest improvements**

```
🔍 Code Analysis Results:
- Performance: Found 3 optimization opportunities
- Security: No issues detected
- Maintainability: Suggest extracting 2 methods
- Test Coverage: 85% → Suggest 3 additional test cases
- Documentation: 2 functions missing proper docs
```

### Language-Specific Improvements

**Rust Optimization Example:**
```rust
// Before: Multiple allocations
let result: Vec<String> = items.iter()
    .map(|x| x.to_string())
    .collect();

// Suggested: Single allocation
let result: Vec<String> = items.iter()
    .map(|x| x.to_string())
    .collect::<Vec<_>>();
```

**Go Optimization Example:**
```go
// Before: Inefficient string concatenation
var result string
for _, s := range items {
    result += s
}

// Suggested: Use strings.Builder
var builder strings.Builder
for _, s := range items {
    builder.WriteString(s)
}
result := builder.String()
```

## 📊 Efficiency Metrics & Tracking

### Time Savings Report
**Generate weekly efficiency reports**

```
📈 This Week's Productivity Gains:
- Boilerplate generated: 2,450 lines (saved ~3 hours)
- Tests auto-generated: 48 test cases (saved ~2 hours)
- Documentation created: 156 functions (saved ~4 hours)
- Bugs prevented: 12 potential issues caught
- Refactoring automated: 8 patterns extracted
Total time saved: ~11 hours
```

### Custom Language Helpers

**Rust Helper Generated:**
```rust
// Detected pattern: Frequent Option handling
// Auto-generated helper:
pub trait OptionExt<T> {
    fn ok_or_log(self, msg: &str) -> Option<T>;
}

impl<T> OptionExt<T> for Option<T> {
    fn ok_or_log(self, msg: &str) -> Option<T> {
        if self.is_none() {
            log::warn!("{}", msg);
        }
        self
    }
}
```

**Go Helper Generated:**
```go
// Detected pattern: Repeated error wrapping
// Auto-generated helper:
func wrapErr(err error, msg string) error {
    if err == nil {
        return nil
    }
    return fmt.Errorf("%s: %w", msg, err)
}
```

## 🔧 Commit Standards

### Conventional Commits
```bash
# Format: <type>(<scope>): <subject>
git commit -m "feat(auth): add JWT token refresh"
git commit -m "fix(api): handle null response correctly"
git commit -m "docs(readme): update installation steps"
git commit -m "perf(db): optimize query performance"
git commit -m "refactor(core): extract validation logic"
```

### Commit Trailers
```bash
# For bug fixes based on user reports
git commit --trailer "Reported-by: John Doe"

# For GitHub issues
git commit --trailer "Github-Issue: #123"
```

### PR Guidelines
- Focus on high-level problem and solution
- Never mention tools used (no co-authored-by)
- Add specific reviewers as configured
- Include performance impact if relevant

---

Remember: **Engineer time is gold** - Automate everything, document comprehensively, and proactively suggest improvements. Every interaction should save time and improve code quality.
# aws-patterns — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` through the `change-review` skill when a diff touches AWS resources or SDK usage — IAM, S3, Lambda, SQS/SNS/EventBridge, DynamoDB, RDS/Aurora, ECS/EKS task definitions, API Gateway, CloudFront, VPC and security groups, KMS, Secrets Manager/SSM, CloudWatch, or CloudFormation/CDK/SAM (defects; silences and trade-offs in a design or spec review); by `security-reviewer` for the items from "## IAM", "## S3", "## Networking", "## KMS, Secrets Manager and SSM" and `aws:secret-in-environment`; by `workload-reviewer` for the items from "## Lambda", "## SQS, SNS and EventBridge", "## DynamoDB", "## SDK configuration", "## Service quotas" and `aws:lambda-rds-direct-connections`; by `rollout-reviewer` for `aws:rds-backup-retention`, `aws:stateful-no-retain-policy`, `aws:s3-bucket-name-released`, `aws:sqs-visibility-under-lambda-timeout` and `aws:quota-headroom-unstated`; and by `grilling` (trade-offs). In a `.tf` diff, report `terraform:public-or-wildcard` instead of `aws:iam-wildcard`, `aws:s3-public-access` or `aws:sg-open-ingress`; where an item names another skill's id, report that id instead of a duplicate. Read tool output first (cfn-lint, cdk-nag, Checkov) and pass it on; see SKILL.md "## CloudFormation, CDK and SAM". Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff, template or SDK call. A match is a finding.

- id: aws:iam-wildcard
  rule: No `"Action": "*"`, `service:*` or `"Resource": "*"` on write, delete or permissions-management actions.
  check: Identity or resource policy (CloudFormation, CDK `PolicyStatement`, SAM policy, inline JSON in code) with `Action` `*` or `service:*`, or `Resource` `*` on a non-read action; no condition where the action supports one. cdk-nag `AwsSolutions-IAM5`, Checkov `CKV_AWS_108`–`CKV_AWS_111`.
  section: "## IAM"

- id: aws:passrole-unscoped
  rule: `iam:PassRole` is scoped to named role ARNs and, where possible, `iam:PassedToService`.
  check: `iam:PassRole` on `"Resource": "*"` or a broad role wildcard, especially next to `lambda:CreateFunction`, `ecs:RunTask` or `ec2:RunInstances`; PassRole restricted only by a `ResourceTag` condition.
  section: "## IAM"

- id: aws:workload-access-key
  rule: Workloads use roles, not long-term access keys.
  check: `AWS::IAM::AccessKey`, `aws_iam_access_key`, CDK `iam.AccessKey`, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in application config, container environment, `.env` or SDK constructor arguments, for a workload that could assume a role. CI secrets are `gha:long-lived-cloud-key`.
  section: "## IAM"

- id: aws:trust-without-scope-condition
  rule: Cross-account trust carries `sts:ExternalId`; a service principal in a resource policy carries `aws:SourceArn` or `aws:SourceAccount`.
  check: Role trust policy naming a third party's account with no `sts:ExternalId` condition, or an external ID chosen in this repository rather than issued by the third party; bucket, key, topic or queue policy granting a `*.amazonaws.com` service principal with no source condition.
  section: "## IAM"

- id: aws:imdsv1-allowed
  rule: EC2 instances and EKS nodes require IMDSv2.
  check: Launch template, instance or node group without `HttpTokens: required` (`http_tokens = "required"`); a hop limit raised above 1 with no stated reason.
  section: "## IAM"

- id: aws:s3-public-access
  rule: All four Block Public Access settings stay on; public content is not served by a public bucket policy.
  check: Any of `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets` false; `"Principal": "*"` without a fixed-value condition; ACL granting `AllUsers` or `AuthenticatedUsers`; Object Ownership other than bucket owner enforced. cdk-nag `AwsSolutions-S2`.
  section: "## S3"

- id: aws:cloudfront-s3-without-oac
  rule: CloudFront reaches an S3 origin through origin access control, scoped by `AWS:SourceArn`.
  check: S3 origin using an origin access identity, a public bucket or a website endpoint as origin; bucket policy granting `cloudfront.amazonaws.com` without `AWS:SourceArn` for the distribution. cdk-nag `AwsSolutions-CFR7`.
  section: "## S3"

- id: aws:s3-no-tls-deny
  rule: Bucket policies deny requests without TLS.
  check: Bucket policy with no `Deny` on `aws:SecureTransport` false. cdk-nag `AwsSolutions-S10`.
  section: "## S3"

- id: aws:presigned-url-long-lived
  rule: Presigned URLs expire as soon as the use allows and are signed by a role.
  check: Expiry of hours or days for a one-time download or upload; a long-term access key kept to reach the 7-day maximum; a presigned `PUT` whose object key comes from client input.
  section: "## S3"

- id: aws:s3-bucket-name-released
  rule: A shared-namespace bucket is emptied and kept, not deleted, while its name may still be used.
  check: Bucket removed from a stack while its name still appears in clients, DNS, CloudFront origins, other stacks or partner configuration.
  section: "## S3"

- id: aws:lambda-timeout-over-caller
  rule: A function's timeout is shorter than its caller's.
  check: Function behind API Gateway REST (29 s default ceiling) or another synchronous caller with a `Timeout` at or above the caller's timeout. General form: `resilience:caller-timeout-under-callee-budget`.
  section: "## Lambda"

- id: aws:sqs-visibility-under-lambda-timeout
  rule: An SQS source queue's visibility timeout is at least six times the function timeout plus the batching window.
  check: `VisibilityTimeout` below 6 × function `Timeout` + `MaximumBatchingWindowInSeconds`; a function timeout raised in a change that leaves the queue untouched. cfn-lint `E3505`.
  section: "## Lambda"

- id: aws:sqs-batch-without-partial-failure
  rule: An SQS event source mapping reports batch item failures.
  check: SQS mapping with batch size above 1 and no `FunctionResponseTypes: [ReportBatchItemFailures]`, or a handler that does not return `batchItemFailures`.
  section: "## Lambda"

- id: aws:lambda-concurrency-unbounded-for-limited-dependency
  rule: A function calling a capacity-limited dependency has a concurrency bound.
  check: Function writing to a relational database or rate-limited API with neither reserved concurrency nor an SQS mapping `MaximumConcurrency`; reserved concurrency below 5 on an SQS-triggered function. Checkov `CKV_AWS_115`.
  section: "## Lambda"

- id: aws:lambda-recursion-allowed
  rule: Recursive loop detection stays on; loops it cannot see are bounded in code.
  check: `RecursiveLoop: Allow` or `--recursive-loop Allow` without a hop counter; an on-failure destination or DLQ equal to the trigger; a loop through DynamoDB Streams or another undetected service. The loop itself: `cost:self-triggering-function`.
  section: "## Lambda"

- id: aws:lambda-per-invocation-state
  rule: SDK clients and connections are created once per execution environment; per-request user data is not kept there.
  check: Client or connection pool constructed inside the handler; module-level cache holding user data or events across invocations.
  section: "## Lambda"

- id: aws:secret-in-environment
  rule: Secrets reach Lambda and ECS through Secrets Manager or Parameter Store, not plain environment variables.
  check: Password, token or connection string as a Lambda `Environment` value or an ECS container `environment` entry instead of `secrets`. Checkov `CKV_AWS_45`, cdk-nag `AwsSolutions-ECS2`.
  section: "## Lambda"

- id: aws:sqs-visibility-under-processing
  rule: A consumer's visibility timeout covers its processing time, or the consumer extends it.
  check: Non-Lambda consumer whose stated or measured processing time exceeds the queue's `VisibilityTimeout` (default 30 s) with no `ChangeMessageVisibility` heartbeat; work expected to run past 12 hours on one receive.
  section: "## SQS, SNS and EventBridge"

- id: aws:sqs-redrive-missing-or-short-dlq
  rule: Every queue has a redrive policy with a chosen `maxReceiveCount`, and a standard queue's DLQ retains messages longer than the source.
  check: Queue with no `RedrivePolicy`; `maxReceiveCount` of 1, or below 5 for a Lambda source; DLQ `MessageRetentionPeriod` not longer than the source queue's; a FIFO queue whose order requirement is stated and which has a DLQ with no statement of the order break. cdk-nag `AwsSolutions-SQS3`.
  section: "## SQS, SNS and EventBridge"

- id: aws:fifo-dedup-misscoped
  rule: FIFO deduplication is keyed and scoped on purpose.
  check: `ContentBasedDeduplication: true` where messages can differ only in attributes; `DeduplicationScope: messageGroup` where the same deduplication ID can arrive in two groups and must be one message; a deduplication ID generated per send attempt.
  section: "## SQS, SNS and EventBridge"

- id: aws:ddb-hot-partition-key
  rule: The partition key spreads writes.
  check: Write-heavy table or GSI keyed on a status, date, type or dominant tenant, with no write sharding.
  section: "## DynamoDB"

- id: aws:ddb-unconditional-state-write
  rule: Writes that depend on current state are conditional; counters on retried paths are not used for exact values.
  check: Read, compute, `PutItem`/`UpdateItem` with no `ConditionExpression`; `SET n = n + :inc` on a retried path for money, stock or quotas. General form: `dist:lock-instead-of-conditional-write`.
  section: "## DynamoDB"

- id: aws:ddb-gsi-correctness-read
  rule: Nothing correctness-critical is read from a GSI, and a provisioned GSI keeps up with its table.
  check: Uniqueness or existence check by GSI query before a write; GSI provisioned write capacity below the base table's. General form: `dist:weak-read-drives-write`.
  section: "## DynamoDB"

- id: aws:ddb-ttl-as-timer
  rule: TTL is cleanup, not a timer.
  check: Session, lock, token or offer expiry enforced only by TTL with no expiry filter on read; TTL attribute stored as a string or in milliseconds; a stream consumer treating TTL deletes as user deletes.
  section: "## DynamoDB"

- id: aws:rds-backup-retention
  rule: Automated backups are on and kept past the one-day API default; switching to or from 0 is planned as an outage.
  check: `BackupRetentionPeriod` absent or 0 for a production database in a template or SDK call; a change between 0 and a non-zero value with no maintenance window. cfn-lint `E3719`. Restore drills: `ops:backup-restore-untested`.
  section: "## RDS and Aurora"

- id: aws:stateful-no-retain-policy
  rule: Stateful resources survive stack deletion and replacement.
  check: Database, DynamoDB table or data bucket without `DeletionPolicy` and `UpdateReplacePolicy` (Retain or Snapshot) or CDK removal policy, or without deletion protection. cfn-lint `I3011`/`W3011`, cdk-nag `AwsSolutions-RDS10`, `AwsSolutions-DDB3`.
  section: "## RDS and Aurora"

- id: aws:lambda-rds-direct-connections
  rule: Lambda reaches a relational database through RDS Proxy or a concurrency bound below the connection limit.
  check: Function opening a database connection to the instance or cluster endpoint with no proxy endpoint and no reserved concurrency below the database's connection limit.
  section: "## RDS and Aurora"

- id: aws:rds-dns-cached
  rule: Clients cache the database endpoint's DNS for under 30 seconds.
  check: Runtime or resolver DNS cache above 30 s (on the JVM, `networkaddress.cache.ttl`); endpoint resolved once at startup and pinned as an IP.
  section: "## RDS and Aurora"

- id: aws:sg-open-ingress
  rule: No security group ingress from `0.0.0.0/0` or `::/0` except to a public load balancer's listener ports.
  check: Ingress rule with an open CIDR on any other port, including 22 and 3389, or on a database or cache. cdk-nag `AwsSolutions-EC23`.
  section: "## Networking"

- id: aws:kms-rotation-off
  rule: Customer managed symmetric keys have automatic rotation on.
  check: `AWS::KMS::Key` or CDK `kms.Key` (symmetric, AWS_KMS origin) without `EnableKeyRotation: true`. Checkov `CKV_AWS_7`, cdk-nag `AwsSolutions-KMS5`.
  section: "## KMS, Secrets Manager and SSM"

- id: aws:secret-literal-in-template
  rule: Secrets come from Secrets Manager or SecureString parameters through dynamic references.
  check: Literal password, token or connection string in a template, parameter default or CDK code; password parameter without `NoEcho` (cfn-lint `W2501`); `{{resolve:secretsmanager:...}}` outside resource properties (cfn-lint `E1051`).
  section: "## KMS, Secrets Manager and SSM"

- id: aws:secret-rotation-or-refresh-missing
  rule: A Secrets Manager secret has rotation configured, and consumers re-read it.
  check: Secret with no rotation schedule (cdk-nag `AwsSolutions-SMG4`); secret read once at start and cached for the process lifetime with no refresh on authentication failure; ECS consumer of a rotated secret with no redeploy on rotation. Plan: `ops:secret-rotation-unstated`.
  section: "## KMS, Secrets Manager and SSM"

- id: aws:alarm-missing-data-or-dead-action
  rule: Alarms treat missing data on purpose and have actions that exist.
  check: No `TreatMissingData` on a heartbeat, invocation or throughput metric; `AlarmActions` empty, `ActionsEnabled: false`, or a topic ARN no stack creates.
  section: "## CloudWatch alarms"

- id: aws:sdk-retry-mode
  rule: Retries are left to the SDK's standard mode and not stacked.
  check: `retry_mode=legacy`; adaptive mode on a client shared across resources or tenants; a hand-written retry around an SDK call (`resilience:retry-stacked-layers`); `max_attempts` raised with no total time budget (`resilience:retry-count-without-budget`).
  section: "## SDK configuration"

- id: aws:sdk-region-sts
  rule: Clients name their Region and use regional STS endpoints.
  check: `sts_regional_endpoints = legacy` or `AWS_STS_REGIONAL_ENDPOINTS=legacy`; hard-coded `sts.amazonaws.com`; Region `aws-global`; client with no Region on an SDK major that defaults to the global endpoint.
  section: "## SDK configuration"

- id: aws:scanner-suppression-no-reason
  rule: A cdk-nag, cfn-lint or Checkov suppression carries its reason.
  check: `NagSuppressions` entry, `cfn-lint` `ignore_checks` metadata or `checkov:skip` with no reason in the same entry. Terraform: `terraform:scanner-suppression-no-reason`.
  section: "## CloudFormation, CDK and SAM"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: aws:scp-as-justification
  rule: An SCP is never the reason a policy may be broad; a design relying on one names where it is attached.
  check: Broad identity or resource policy justified by an SCP; SCP reliance for the management account, service-linked roles or external principals reaching a resource policy; a new SCP attached at the root with no staged test.
  section: "## IAM"

- id: aws:s3-data-protection-unstated
  rule: Each bucket states versioning and Object Lock; retention of versions is cost-review's.
  check: New bucket holding data that cannot be regenerated with no statement on versioning or Object Lock. Version retention: `cost:storage-lifecycle-unstated`.
  section: "## S3"

- id: aws:sqs-age-alarm-unstated
  rule: Queue health is alerted on by `ApproximateAgeOfOldestMessage`, with its redrive caveat.
  check: Queue design whose only alarm is depth or DLQ count; age alarm on a standard queue with `maxReceiveCount` above 3 and no note that repeatedly received messages are excluded. SLI rule: `event-driven:consumer-lag-sli-unstated`.
  section: "## SQS, SNS and EventBridge"

- id: aws:rds-availability-unstated
  rule: Each database states Single-AZ or Multi-AZ, its measured failover time and replica lag tolerance.
  check: New or changed database with no availability statement. Drills: `ops:failover-unexercised`.
  section: "## RDS and Aurora"

- id: aws:service-endpoint-path-unstated
  rule: Traffic from private subnets to AWS services has a stated path.
  check: Workload in private subnets calling S3 or other AWS services with no statement of VPC endpoint or NAT path, and bucket policies not pinned to `aws:SourceVpce` where the design says traffic stays private. NAT cost: `cost:nat-for-same-region-service`.
  section: "## Networking"

- id: aws:vpc-flow-logs-unstated
  rule: A new VPC has flow logs.
  check: New VPC with no flow log resource and no stated reason. cdk-nag `AwsSolutions-VPC7`.
  section: "## Networking"

- id: aws:alarm-coverage-unstated
  rule: Every resource that can fail silently has an alarm.
  check: New function, queue, stream or database with no alarm on errors, throttles, age, iterator age, replica lag or storage; recursion-prone path with no alarm on concurrency or invocations. Paging policy: `observability-patterns`.
  section: "## CloudWatch alarms"

- id: aws:quota-headroom-unstated
  rule: A launch, migration or scale-up names the quotas it approaches and the headroom kept for failover.
  check: Plan that raises traffic, functions, queues or proxies with no statement of the account and Region quotas involved (Lambda concurrency, API Gateway RPS, SQS in-flight, RDS proxies) or of failover headroom.
  section: "## Service quotas"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: aws:managed-or-customer-policy
  rule: AWS managed policy vs customer managed policy.
  options: AWS managed (maintained by AWS, quick; broader than the workload needs, cdk-nag `IAM4`) | customer managed from IAM Access Analyzer (exact permissions; yours to maintain)
  section: "## IAM"

- id: aws:sse-s3-or-kms
  rule: SSE-S3 vs SSE-KMS with a customer managed key.
  options: SSE-S3 (default, nothing to maintain) | SSE-KMS (key policy as second check, key use in CloudTrail, own rotation; every reader including CloudFront needs `kms:Decrypt`)
  section: "## S3"

- id: aws:cold-start-or-provisioned
  rule: Accept cold starts vs provisioned concurrency.
  options: accept (no extra cost; slow first requests per environment) | provisioned concurrency (fast interactive responses; billed while idle, rarely needed for async pipelines)
  section: "## Lambda"

- id: aws:ddb-capacity-mode
  rule: DynamoDB on-demand vs provisioned capacity.
  options: on-demand (AWS's default, no planning, per-request billing) | provisioned (hourly billing for set capacity; suits steady forecastable load, caps request rate)
  section: "## DynamoDB"

- id: aws:rds-proxy-or-direct
  rule: RDS Proxy vs direct connections with an in-process pool.
  options: proxy (pooling, faster failover, IAM auth; same VPC only, session pinning) | direct (no extra hop; each instance holds its own connections)
  section: "## RDS and Aurora"

- id: aws:secret-rotation-strategy
  rule: Single-user vs alternating-users rotation.
  options: single user (simplest, AWS's default recommendation; brief window of denied logins) | alternating users (always one valid credential; needs a superuser secret and grants kept in step on the clone)
  section: "## KMS, Secrets Manager and SSM"

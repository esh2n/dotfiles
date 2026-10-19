---
name: aws-patterns
description: Use when writing or reviewing anything that creates, configures or calls AWS resources — IAM policies, roles and trust policies, S3 buckets and presigned URLs, Lambda functions and event source mappings, SQS, SNS and EventBridge, DynamoDB tables and indexes, RDS or Aurora, ECS or EKS task definitions, API Gateway, CloudFront, VPC security groups and endpoints, KMS keys, Secrets Manager or SSM parameters, CloudWatch alarms, AWS SDK client configuration, or CloudFormation, CDK and SAM templates — and when diagnosing AccessDenied, a public bucket, a Lambda that runs twice or loops, an SQS message processed twice or stuck in a DLQ, DynamoDB throttling on one key, "too many connections" from Lambda to RDS, an alarm that never fired, or a quota hit during a launch.
metadata:
  namespaces: [platform/infra]
---

# AWS Patterns

Judgment criteria for AWS resources and SDK usage, as declared in
CloudFormation, CDK, SAM or code. Sources opened 2026-10-19; AWS Builders'
Library articles now live under builder.aws.com and the old
aws.amazon.com/builders-library links redirect there.

Each rule is tagged: **[defect]** is checkable in a diff or template and a
match is a finding; **[silence]** is something a design or PR must state, and
its absence with a concrete consequence is the finding; **[trade-off]** is
defensible either way and is a question for the owner, never a finding.

What this skill does not own, and where it lives instead:

- Terraform mechanics (state, plan, `moved`, lifecycle) and the Trivy and
  Checkov table for `.tf` files — `terraform-patterns`. In a `.tf` diff, a
  public bucket, open ingress or IAM wildcard is reported as
  `terraform:public-or-wildcard`, not with an `aws:` id.
- Recursive triggers as a cost problem, NAT gateways for same-region S3 and
  DynamoDB traffic, log retention, budgets — `cost-review`
  (`cost:self-triggering-function`, `cost:nat-for-same-region-service`,
  `cost:log-retention-missing`, `cost:budget-as-cap`).
- Timeouts, retry budgets, jitter and retries stacked across layers in
  general — `resilience-patterns`.
- Consumer idempotency, DLQ content, consumer lag and age SLIs —
  `event-driven-patterns`.
- Conditional writes as a replacement for locks, weak reads driving writes,
  replica lag — `distributed-correctness`.
- OIDC trust for CI deploy roles and long-lived keys stored as CI secrets —
  `github-actions-patterns` (`gha:long-lived-cloud-key`,
  `gha:oidc-trust-unscoped`).
- Backup restore drills, failover drills, secret rotation plans —
  `ops-readiness` (`ops:backup-restore-untested`, `ops:failover-unexercised`,
  `ops:secret-rotation-unstated`).
- Pod specs and probes on EKS — `k8s-patterns`.

## IAM

**[defect] No `"Action": "*"`, `service:*` or `"Resource": "*"` on write,
delete or permissions-management actions.** AWS defines least privilege as
specific actions on specific resources under specific conditions, and says
AWS managed policies are a starting point that may not be least privilege for
your case (https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).
The Well-Architected security pillar lists "overly permissive policies without
proper scoping" as an anti-pattern
(https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_permissions_least_privileges.html).
Scope `Resource` to ARNs and add the conditions the action supports
(`aws:SecureTransport`, `aws:PrincipalOrgID`, `aws:SourceVpce`). Detection:
cdk-nag `AwsSolutions-IAM5` flags wildcards without a documented suppression
(https://github.com/cdklabs/cdk-nag/blob/main/RULES.md); Checkov
`CKV_AWS_108`–`CKV_AWS_111` flag exfiltration, permissions management,
privilege escalation and unconstrained write
(https://www.checkov.io/5.Policy%20Index/cloudformation.html).

**[defect] `iam:PassRole` is scoped to named role ARNs and, where possible,
to `iam:PassedToService`.** Passing a role lets a principal hand a service
more permissions than the principal holds itself; AWS's example is a user
with no S3 access passing a role that has it
(https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html).
The same page warns that restricting PassRole by `ResourceTag` gives
unreliable results, and that PassRole is a permission rather than an API call,
so CloudTrail records it only inside the call that created the resource.
`iam:PassRole` on `"Resource": "*"` combined with `lambda:CreateFunction`,
`ecs:RunTask` or `ec2:RunInstances` is privilege escalation.

**[defect] Workloads use roles, not access keys.** AWS asks for temporary
credentials through roles for workloads on AWS, and IAM Roles Anywhere or
`AssumeRoleWithWebIdentity` outside it; long-term keys are for the listed
exceptions such as third-party clients that cannot assume a role
(https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).
Check: `AWS::IAM::AccessKey`, `aws_iam_access_key`, `iam.AccessKey` in CDK, or
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in application config, a container
environment or a `.env` file. Negative evidence: in a 2024 campaign attackers
scanned for publicly served `.env` files, found over 90,000 leaked variable
sets containing access keys, and escalated from a key that could call
`iam:CreateRole` and attach policies to an administrator role
(https://unit42.paloaltonetworks.com/large-scale-cloud-extortion-operation/).

**[defect] Cross-account and service trust carries a scope condition.** A
role trusted by a third party's account needs `sts:ExternalId` in the trust
policy, with the value issued by the third party, unique per customer, and
not chosen by you; a resource policy that grants a service principal
(`cloudtrail.amazonaws.com`, `cloudfront.amazonaws.com`) needs
`aws:SourceArn` or `aws:SourceAccount`, or anyone who can point that service
at your resource reaches it — the confused deputy
(https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html).

**[defect] EC2 instances and EKS nodes require IMDSv2.** By default both
IMDSv1 and IMDSv2 are accepted; setting token use to required makes IMDSv1
calls fail, and AWS points to IMDSv2 as defense against open proxies and SSRF
(https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html).
The default hop limit of 1 blocks containers that are one network hop away;
raising it is a choice to state. Negative evidence: the 2019 Capital One
intrusion relayed requests through a misconfigured web application firewall
to the instance metadata service and used the role credentials it returned,
which could list and read storage buckets
(https://krebsonsecurity.com/2019/08/what-we-can-learn-from-the-capital-one-hack/).

**[silence] An SCP is never the reason a policy may be broad.** SCPs and RCPs
grant nothing; they cap what identity and resource policies grant
(https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html). SCPs
do not apply to the management account, to service-linked roles, or to
principals outside the organization reaching a resource through its resource
policy (https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html).
A design that says "the SCP blocks that" names the account and OU the SCP is
attached to and still scopes the role. AWS also warns against attaching an
untested SCP at the organization root (same page).

**[trade-off] AWS managed policy vs customer managed policy.** Options:
managed (maintained by AWS, quick to adopt; broader than the workload needs,
flagged by cdk-nag `AwsSolutions-IAM4`) | customer managed generated from
access activity with IAM Access Analyzer (exact permissions; yours to
maintain as the code changes)
(https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).

## S3

**[defect] All four Block Public Access settings stay on, and a public
policy is never the way to serve content.** New buckets, access points and
objects do not allow public access by default, and AWS recommends all four
settings on at account and bucket level
(https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html).
The settings do not change existing policies or ACLs, so turning one off
re-exposes whatever public policy was already attached (same page). A bucket
policy counts as public unless every grant is pinned to fixed values such as a
principal, `aws:SourceArn`, `aws:SourceVpce` or a CIDR no broader than /8
(same page). Check: `BlockPublicAcls`, `IgnorePublicAcls`,
`BlockPublicPolicy` or `RestrictPublicBuckets` set to false;
`"Principal": "*"` without such a condition; an ACL granting `AllUsers` or
`AuthenticatedUsers`; Object Ownership other than bucket owner enforced, which
re-enables ACLs (https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).
cdk-nag `AwsSolutions-S2`. Negative evidence: a bucket with no access
restriction exposed records on about 198 million US voters in 2017
(https://www.upguard.com/breaches/the-rnc-files).

**[defect] CloudFront reaches S3 through origin access control.** AWS
recommends OAC over the legacy origin access identity, which lacks SSE-KMS,
newer Regions and `PUT`/`DELETE`; the bucket policy grants
`cloudfront.amazonaws.com` with `AWS:SourceArn` set to the distribution, and
an S3 website endpoint cannot use OAC at all
(https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).
cdk-nag `AwsSolutions-CFR7`.

**[defect] Bucket policies deny requests without TLS.** AWS recommends a
deny on `aws:SecureTransport` false
(https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html);
cdk-nag `AwsSolutions-S10`.

**[defect] Presigned URLs expire as soon as the use allows, and are signed
by a role.** A presigned URL is a bearer token usable any number of times
until it expires; with IAM user keys it can last 7 days, with role
credentials it dies with the session; a presigned `PUT` overwrites any
existing object at that key; and `s3:signatureAge` in a bucket policy caps
how old a signature may be
(https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
Check: an expiry of hours or days for a one-time download or upload, a
long-term access key kept in the service to get the 7-day maximum, or a
presigned `PUT` whose key comes from client input.

**[silence] Data protection is stated per bucket.** Every bucket is encrypted
with SSE-S3 by default and SSE-C is disabled on new buckets since April 2026,
so "encryption at rest" alone is no longer the question; what the design
states is whether versioning (recovery from deletes and overwrites) and Object
Lock (write once, read many) apply (same page). Retention and lifecycle of
current and noncurrent versions is `cost:storage-lifecycle-unstated`.

**[defect] A general purpose bucket in the shared namespace is emptied and
kept, not deleted, while anything may still use its name.** Another account
can recreate a deleted bucket name and receive requests meant for yours
(https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).
Check: a removed bucket whose name still appears in clients, DNS, CloudFront
origins or other stacks.

**[trade-off] SSE-S3 vs SSE-KMS.** Options: SSE-S3 (default, no key
policy to maintain) | SSE-KMS with a customer managed key (key policy as a
second access check, key use visible in CloudTrail, rotation under your
control; every reader, including CloudFront, needs `kms:Decrypt` through the
key policy)
(https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html,
https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).

## Lambda

**[defect] A function's timeout is shorter than its caller's.** A REST API
in API Gateway gives an integration 50 ms to 29 s; Regional and private APIs
can raise the ceiling at the cost of Region-level throttle quota
(https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-execution-service-limits-table.html).
A function set to 60 s behind that API keeps running and billing after the
client got a 504, and a client retry starts a second copy. AWS asks for load
tests to choose the timeout
(https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html). The
general rule is `resilience:caller-timeout-under-callee-budget`.

**[defect] An SQS source queue's visibility timeout is at least six times the
function timeout, plus the batching window.** The margin lets Lambda retry
after throttling. Lambda rejects a mapping whose queue visibility timeout is
below the function timeout, but raising the function timeout afterwards can
produce duplicate invocations
(https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html,
https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html). cfn-lint
`E3505` checks visibility timeout against function timeout
(https://github.com/aws-cloudformation/cfn-lint/blob/main/docs/rules.md).

**[defect] An SQS mapping reports batch item failures.** Without
`ReportBatchItemFailures`, one failed message returns the whole batch to the
queue and every message in it is processed again
(https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html).
Event source mappings deliver at least once, and AWS asks for idempotent
handlers (https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html);
the handler rule itself is `event-driven:consumer-not-idempotent`.

**[defect] A function that calls a capacity-limited dependency has a
concurrency bound.** Lambda scales past what a database or third-party API
can take; reserved concurrency caps the function and also reserves that
capacity away from the rest of the account, of which 100 units always stay
unreserved
(https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).
For SQS sources the mapping's maximum concurrency is the other lever, and with
reserved concurrency AWS asks for at least five
(https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html).
Checkov `CKV_AWS_115`. The cost cap for the same setting is
`cost:scaling-cap-default`.

**[defect] Recursive loop detection stays on, and covers less than it
seems.** Lambda stops a chain after about 16 invocations only for loops
through SQS, S3, SNS, EventBridge custom buses and Lambda itself, and only
with a supported SDK version; loops through DynamoDB or other services are
not detected
(https://docs.aws.amazon.com/lambda/latest/dg/invocation-recursion.html).
Check: `RecursiveLoop: Allow` (or `put-function-recursion-config --recursive-loop
Allow`) without a hop counter in code; an on-failure destination or DLQ that is
also the function's trigger. The loop itself is
`cost:self-triggering-function`.

**[defect] Clients are created once per execution environment, and user
data is not.** AWS asks for SDK clients and connections to be initialized
outside the handler, and warns against keeping user data or events in the
execution environment, which later invocations reuse
(https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html). Check: a
client or connection pool constructed inside the handler; a module-level
cache keyed by nothing, holding per-request user data.

**[defect] Secrets are not plain environment variables.** Lambda encrypts
environment variables with a KMS key, but the default key needs no KMS
permission, so hiding them from people who manage the function takes an
explicit deny on `kms:Decrypt`; AWS recommends Secrets Manager for database
credentials
(https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars-encryption.html).
For ECS, pass secrets through the task definition's `secrets` field from
Secrets Manager or Parameter Store; the value is fixed at task start, so a
rotated secret needs a new deployment
(https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html).
Checkov `CKV_AWS_45`, cdk-nag `AwsSolutions-ECS2`.

**[trade-off] Cold starts.** Options: accept them (no extra cost; first
requests on a new environment are slow) | provisioned concurrency
(pre-initialized environments for interactive traffic; billed while idle) —
AWS notes asynchronous pipelines usually do not need it
(https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).

## SQS, SNS and EventBridge

**[defect] A consumer's visibility timeout covers its processing time, or the
consumer extends it.** The default is 30 s; a message not deleted before the
timeout becomes visible to another consumer; long work extends visibility
with `ChangeMessageVisibility` as a heartbeat, up to 12 hours from first
receipt (https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html).
Even inside the timeout, SQS delivers at least once (same page).

**[defect] Every queue has a redrive policy with a chosen `maxReceiveCount`,
and the DLQ outlives the source.** `maxReceiveCount` of 1 dead-letters on the
first failure; Lambda sources should use at least 5
(https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html).
For standard queues a message keeps its original enqueue timestamp in the
DLQ, so a DLQ retention no longer than the source's deletes dead letters
early; AWS advises a longer retention
(https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).
A FIFO queue's DLQ must be FIFO and breaks strict order (same page,
https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_CreateQueue.html).
cdk-nag `AwsSolutions-SQS3`.

**[defect] FIFO deduplication is scoped and keyed on purpose.** FIFO
deduplicates sends only within a 5-minute interval
(https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html).
Content-based deduplication hashes the body but not message attributes, so
two messages differing only in attributes are treated as one; high-throughput
mode sets `DeduplicationScope` to `messageGroup`, so the same deduplication
ID in two groups is not a duplicate
(https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_CreateQueue.html).
Consumer-side dedup is still required (`event-driven-patterns`, Delivery
semantics).

**[silence] Queue health is alerted on by message age.** Amazon measures
backlog by the age of queued messages, since DLQ rates detect a problem late
(https://builder.aws.com/content/3EuRcgkTP1MI0c7zM8W6HL3WIqA/avoiding-insurmountable-queue-backlogs).
On SQS the metric is `ApproximateAgeOfOldestMessage`; with a redrive policy
and `maxReceiveCount` above 3, a standard queue moves repeatedly received
messages to the back and the metric then reflects the next message instead
(https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).
The SLI rule is `event-driven:consumer-lag-sli-unstated`.

SNS subscriptions and EventBridge rules deliver to the same consumers; their
retry and DLQ settings follow `event-driven-patterns` § Poison messages and
DLQ policy. For a Lambda subscribed to SNS, AWS suggests an on-failure
destination (https://docs.aws.amazon.com/lambda/latest/dg/invocation-recursion.html).

## DynamoDB

**[defect] The partition key spreads writes.** Each partition serves up to
3,000 read units and 1,000 write units per second, and item size multiplies
units (a 20 KB item costs 5 read units per strong read)
(https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html).
Check: a write-heavy table or GSI keyed on a low-cardinality value — a status,
a date, a type, a tenant that dominates traffic — with no write sharding.

**[defect] Writes that depend on current state are conditional.**
`PutItem` and `DeleteItem` are unconditional by default, so two writers lose
one update; a condition expression makes the write fail with
`ConditionalCheckFailedException` instead, and a failed condition still
consumes write capacity
(https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html).
Atomic counters (`SET n = n + :inc`) are not idempotent, so a retried
increment overcounts (same page). Check: read, compute, `PutItem` with no
`ConditionExpression`; an increment on a retried path used for money or
stock. The general form is `dist:lock-instead-of-conditional-write`.

**[defect] Nothing correctness-critical is read from a GSI.** GSIs are
updated asynchronously and support only eventually consistent reads; their
keys are not unique; and on a provisioned table, a GSI with less write
capacity than the base table throttles writes to the base table
(https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html).
Check: a uniqueness or existence check done by querying a GSI before a write;
a GSI provisioned below its table. Weak reads driving writes in general are
`dist:weak-read-drives-write`.

**[defect] TTL is cleanup, not a timer.** TTL deletes expired items
typically within a few days, expired items are returned until then, the
attribute must be a Number in epoch seconds or the item is ignored, and the
deletes appear in streams as service deletions
(https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html).
Check: session, lock, token or offer expiry enforced only by TTL with no
filter on read; a TTL attribute written as a string or in milliseconds; a
stream consumer that handles TTL deletes as user deletes.

**[trade-off] On-demand vs provisioned capacity.** Options: on-demand (AWS's
default and recommendation; no capacity planning, billed per request) |
provisioned (billed per hour for capacity set; suits steady, forecastable
load and caps the request rate)
(https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/capacity-mode.html).

## RDS and Aurora

**[defect] Backups are on and kept past the API default.** A DB instance
created through the API or CLI without a retention period keeps backups for
one day (the console defaults to seven); 0 disables automated backups; the
maximum is 35 days; and changing between 0 and a non-zero value causes an
outage
(https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html).
Check: `BackupRetentionPeriod` absent or 0 in a template for a production
database, or a change to or from 0 without a maintenance window. cfn-lint
`E3719` validates the setting. Restore drills are
`ops:backup-restore-untested`.

**[defect] Stateful resources survive a stack deletion or replacement.**
cfn-lint `I3011` asks stateful resources to set `DeletionPolicy` and
`UpdateReplacePolicy`, and `W3011` asks for both together
(https://github.com/aws-cloudformation/cfn-lint/blob/main/docs/rules.md);
cdk-nag `AwsSolutions-RDS10` flags a database without deletion protection
(https://github.com/cdklabs/cdk-nag/blob/main/RULES.md). The same applies to
DynamoDB tables (cdk-nag `AwsSolutions-DDB3` also asks for point-in-time
recovery) and to S3 buckets holding data.

**[defect] Lambda reaches a relational database through RDS Proxy or a
concurrency bound.** AWS names Lambda's frequent short connections and "too
many connections" errors as the cases RDS Proxy is for; the proxy pools
connections, queues or sheds the excess, and cuts Multi-AZ failover time by up
to 66% by bypassing DNS caches
(https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-planning.html).
Check: a function opening a database connection directly, with neither a
proxy endpoint nor reserved concurrency below the database's connection
limit.

**[defect] Clients do not cache the database's DNS for long.** After a
failover the endpoint's IP changes; AWS asks for a DNS TTL under 30 seconds
in clients that cache, and for failover to be tested with the application
(https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html).
Check: a resolver or runtime DNS cache configured above 30 seconds (on the
JVM, for example, `networkaddress.cache.ttl`), or an endpoint resolved once
at startup and pinned as an IP.

**[silence] Availability is stated per database.** Single-AZ or Multi-AZ
(cdk-nag `AwsSolutions-RDS3`, Checkov `CKV_AWS_157`), the measured failover
time, and the read replicas' lag tolerance (`distributed-correctness`, Read
replicas). Failover drills are `ops:failover-unexercised`.

**[trade-off] RDS Proxy vs direct connections.** Options: proxy
(pooling, faster failover, IAM auth for clients; same VPC only, never publicly
reachable, some statements pin a session to one connection) | direct
connections with an in-process pool (no extra hop; every replica and function
instance holds its own connections)
(https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html).

## Networking

**[defect] No security group ingress from `0.0.0.0/0` or `::/0` except to a
public load balancer's listener ports.** cdk-nag `AwsSolutions-EC23`
(https://github.com/cdklabs/cdk-nag/blob/main/RULES.md). In Terraform report
`terraform:public-or-wildcard`. Databases, caches and admin ports (22, 3389)
take ingress from a security group reference, not a CIDR.

**[silence] Traffic to AWS services from private subnets has a stated path.**
VPC endpoints keep S3 traffic off the internet and let a bucket policy pin
access to `aws:SourceVpc` or `aws:SourceVpce`
(https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).
The cost of routing same-region S3 and DynamoDB traffic through a NAT gateway
is `cost:nat-for-same-region-service`.

**[silence] A new VPC has flow logs.** AWS lists VPC Flow Logs among its VPC
security practices (https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-best-practices.html);
cdk-nag `AwsSolutions-VPC7`. Their retention is `cost:log-retention-missing`.

## KMS, Secrets Manager and SSM

**[defect] Customer managed symmetric keys have automatic rotation on.**
Rotation is optional for customer managed keys and defaults to every 365 days
once enabled; AWS managed keys rotate yearly on their own; asymmetric, HMAC
and custom key store keys must be rotated by hand; rotation neither
re-encrypts data nor rotates data keys already issued
(https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html).
Checkov `CKV_AWS_7`, cdk-nag `AwsSolutions-KMS5`.

**[defect] Secrets live in Secrets Manager or SecureString parameters and
reach templates as dynamic references.** Check: a literal password, token or
connection string in a template, `Parameters` default or CDK code; a password
parameter without `NoEcho` (cfn-lint `W2501`); a
`{{resolve:secretsmanager:...}}` outside resource properties (cfn-lint
`E1051`) (https://github.com/aws-cloudformation/cfn-lint/blob/main/docs/rules.md).

**[defect] A Secrets Manager secret has rotation configured, and its
consumers re-read it.** cdk-nag `AwsSolutions-SMG4` flags a secret with no
rotation schedule (https://github.com/cdklabs/cdk-nag/blob/main/RULES.md).
With single-user rotation there is a short window in which the database has
the new password and the secret still has the old one, so clients retry an
authentication failure by re-fetching the secret
(https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotation-strategy.html).
Check: a secret read once at process start and cached for the process
lifetime with no refresh on auth failure. The rotation plan is
`ops:secret-rotation-unstated`.

**[trade-off] Single-user vs alternating-users rotation.** Options:
single user (simplest, AWS's default recommendation, open connections stay;
brief window of denied logins) | alternating users (one set of credentials is
always valid, suits high availability; needs a superuser secret to clone the
user, and the clone's grants must be kept in step)
(https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotation-strategy.html).

## CloudWatch alarms

**[silence] An alarm is part of every resource that can fail silently.**
AWS asks for alarms on Lambda metrics and on expected duration rather than
metrics written from code, gives Kinesis `IteratorAge` as an example, and
suggests alarms on concurrency, invocations and spend for loops recursion
detection cannot see
(https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html,
https://docs.aws.amazon.com/lambda/latest/dg/invocation-recursion.html). RDS's
operating guidelines ask for alarms on memory, CPU, replica lag and storage
(https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html).
Which signals page a person is `observability-patterns`.

**[defect] Missing data is treated on purpose, and alarm actions exist.** The
default `missing` sends an alarm to `INSUFFICIENT_DATA` when every point in
the window is absent, so an alarm on a metric that stops when the resource
dies never fires; AWS recommends `breaching` for metrics that report
continuously and `notBreaching` for ones emitted only on error, and alarms on
`AWS/DynamoDB` default to `ignore`
(https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html).
CloudWatch does not validate alarm actions
(https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html).
Check: no `TreatMissingData` on a heartbeat, invocation or throughput metric;
`AlarmActions` empty, `ActionsEnabled: false`, or pointing at a topic ARN no
stack creates.

## SDK configuration

**[defect] Retries are left to the SDK's standard mode, and not stacked.**
The SDKs' standard mode retries with jittered backoff, three attempts by
default (four for DynamoDB), behind a client-wide retry quota that stops
retrying when failures are widespread; legacy mode has no standard quota and
AWS asks to move off it; adaptive mode rate-limits every request from a client
once any resource throttles, so it is not for multi-resource or multi-tenant
clients (https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html).
The page also says the 2026 retry behavior is opt-in through
`AWS_NEW_RETRIES_2026=true` until it becomes the default, so the numbers
depend on that setting. Check: `retry_mode=legacy`, adaptive mode on a shared
client, a hand-written retry loop around an SDK call that already retries
(`resilience:retry-stacked-layers`), or `max_attempts` raised with no total
time budget (`resilience:retry-count-without-budget`).

**[defect] Clients name their Region and use regional STS.** AWS's practice
is regional STS endpoints with the Region configured; in opt-in Regions the
global endpoint is served from US East (N. Virginia); older SDK majors (AWS
CLI v1, JavaScript v2, Java 1.x, Go v1) default to the global endpoint
(https://docs.aws.amazon.com/sdkref/latest/guide/feature-sts-regionalized-endpoints.html).
Check: `sts_regional_endpoints = legacy`, a hard-coded `sts.amazonaws.com`,
Region `aws-global`, or a client with no Region relying on the environment.

## Service quotas

**[silence] A launch, migration or scale-up names the quotas it approaches
and the headroom kept for failover.** Well-Architected asks for awareness,
monitoring and automation of quotas and a gap between current quota and
peak usage that absorbs a failover
(https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/manage-service-quotas-and-constraints.html).
Examples opened for this skill: Lambda reserved concurrency leaves 100 units
of the account limit unreserved
(https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html);
API Gateway throttles at 10,000 requests per second per account and Region
(2,500 in some newer Regions)
(https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html);
a standard SQS queue holds about 120,000 in-flight messages
(https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html);
an account has 20 RDS proxies by default
(https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html).

## CloudFormation, CDK and SAM

**[defect] A scanner suppression carries its reason.** cdk-nag expects a
documented justification for `AwsSolutions-IAM5`
(https://github.com/cdklabs/cdk-nag/blob/main/RULES.md); a
`NagSuppressions` entry, `Metadata: cfn-lint: config: ignore_checks` or
`checkov:skip` without a reason in the same entry is a finding, as
`terraform:scanner-suppression-no-reason` is for Terraform.

Tool coverage. Run these before review and pass their output on; a rule a
tool covers is read from the tool's output, not re-derived by hand.

| Tool | Covers here |
|---|---|
| cfn-lint (https://github.com/aws-cloudformation/cfn-lint/blob/main/docs/rules.md) | `E3505` visibility vs function timeout, `I3011`/`W3011` deletion and replace policies, `E3719` backup retention, `W2501` password parameters, `E1051` secret references, `E2531`/`W2531` deprecated runtimes, `E3510`/`E3512`/`E3530` IAM policy validity |
| cdk-nag `AwsSolutions` (https://github.com/cdklabs/cdk-nag/blob/main/RULES.md) | `IAM4`, `IAM5`, `S2`, `S10`, `CFR7`, `SQS3`, `RDS3`, `RDS10`, `DDB3`, `EC23`, `KMS5`, `SMG4`, `VPC7`, `ECS2` |
| Checkov (https://www.checkov.io/5.Policy%20Index/cloudformation.html) | `CKV_AWS_7`, `CKV_AWS_45`, `CKV_AWS_108`–`111`, `CKV_AWS_115`, `CKV_AWS_157`; no check found for RDS backup retention, Secrets Manager rotation or PassRole scope |
| none (reviewer) | caller vs function timeout, partial batch response, concurrency bound for a limited dependency, recursion opt-out, GSI used for uniqueness, TTL as a timer, unconditional writes, DNS caching, missing-data treatment, SDK retry mode, PassRole scope, external ID |

## Related

- `terraform-patterns` — the same resources declared in Terraform.
- `cost-review` — recursive triggers, NAT, retention and worst-case bills.
- `resilience-patterns` — timeout hierarchy, retry budgets, bulkheads.
- `event-driven-patterns` — consumer idempotency, DLQ contents, lag SLIs.
- `distributed-correctness` — conditional writes, consistency, replicas.
- `ops-readiness` — backup and failover drills, secret rotation plans.
- `github-actions-patterns` — OIDC deploy roles.
- `k8s-patterns` — workloads on EKS.
- `gcp-patterns`, `cloudflare-patterns` — the other providers.

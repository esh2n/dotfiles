---
id: "17"
category: en
reader: an engineer who will implement the review output
task: Write a short design note (250-400 words) on where review results go and how the owner answers them.
traps: [lane, house]
must_keep: [Artifact, guard, gh]
---

## Facts

1. Reviewers never post comments on GitHub without permission.
2. The guard blocks gh pr comment, gh pr review, gh issue comment and the same calls made through the API, in personal repositories too.
3. Results go to the chat when there are 5 findings or fewer and no screenshots.
4. Otherwise results go to an Artifact page, with a field per finding where the owner picks a decision; the model reads the saved choices and continues.
5. There are four decisions per finding: the model fixes it, the owner fixes it, the model posts a GitHub comment after showing the text and getting approval, or dismiss.
6. A dismissed finding is recorded as a false positive; a checklist item that keeps producing false positives is removed.

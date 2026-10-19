---
id: "18"
category: en
reader: a user who has not seen the earlier conversation
task: Answer the question "Why does the session not compact earlier, say at 200K tokens?" as a chat reply.
traps: [window, lane]
must_keep: [contextWindow, compaction, omp]
---

## Facts

1. The contextWindow for the main and complex tiers is set to the provider's own 1,000,000 tokens.
2. Compaction fires at 85% of the window, which is 850,000 tokens.
3. omp needs no setting: its 15% reserve gives the same point. pi sets reserveTokens to 150000.
4. No fixed threshold below 85% is pinned, because a fixed number defeats /extended-context on.
5. Summarizing again every ten minutes loses more than a long window costs.

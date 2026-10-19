---
name: ml-pipeline-review
description: Use when a change touches model training or evaluation code, feature pipelines, datasets or their splits, model artifacts and registries, notebooks promoted to code, or model serving — and when judging data leakage (train/test contamination, target leakage, time-based splits), reproducibility (seeds, data versions, environment, GPU kernel nondeterminism), training-serving skew and shared feature definitions, evaluation hygiene (held-out sets, baselines, significance, subgroup slices), data validation, model versioning and lineage, model rollout and rollback, drift monitoring, GPU memory, numerical stability, or personal data in training data. Not for application code that calls an LLM API — that is ai-feature-review.
metadata:
  namespaces: [practice]
---

# ML Pipeline Review

Judgment criteria for code that trains, evaluates, ships and serves a learned
model. The model's behaviour comes from data rather than from code a reviewer
can read, so most failures here produce no error: a leaked feature, a skewed
transform or a stale table shows up only as a metric that is too good offline
or quietly worse in production. Sources were opened on 2026-10-19; PyTorch
pages were read at version 2.14 (the `stable` URLs redirect there).

Routing. Application code that calls a language model (prompts, tool calling,
RAG, evals of model output) is `ai-feature-review`; this file is for models
the project trains, fine-tunes, evaluates or serves itself. Personal data in
training sets is `privacy-review`'s checklist (see the PII section below).
Lock files and dependency pins are `supply-chain-review`; this file only says
why an ML environment must be pinned. Serving timeouts and retries are
`resilience-patterns`.

## Data leakage

Leakage is information the model would not have at prediction time reaching
training or evaluation; it produces optimistic estimates
(https://scikit-learn.org/stable/common_pitfalls.html, §12.2). Kapoor and
Narayanan found leakage-type errors in 41 papers across 30 fields, affecting
648 papers (https://reproducible.cs.princeton.edu/), and grouped it into three
classes: no clean train/test separation (L1), illegitimate features (L2), and
a test set not drawn from the distribution the claim is about (L3)
(https://arxiv.org/abs/2207.07048).

**[defect] Split before any fitted preprocessing.** A scaler, imputer, PCA,
feature selector or over/under-sampler fitted on data that includes the test
rows lets test information into training. scikit-learn's example: selecting 25
of 10,000 random features on all rows before splitting scored 0.76 accuracy on
random labels; selecting after the split scored 0.5. Fitting inside a
`Pipeline` keeps each step on the right subset under cross-validation
(https://scikit-learn.org/stable/common_pitfalls.html, §12.2.1–12.2.2).
Oversampling before the split puts synthetic copies of training rows in the
test set (Kapoor and Narayanan, L1.2, https://arxiv.org/abs/2207.07048).

**[defect] Duplicates and related rows never straddle the split.** Exact
duplicates (L1.4), and different rows from the same patient, user or unit
(L3.2), make the test set measure memorisation
(https://arxiv.org/abs/2207.07048). Split by group: `GroupKFold`,
`StratifiedGroupKFold` or `GroupShuffleSplit`; `train_test_split` cannot
account for groups
(https://scikit-learn.org/stable/modules/cross_validation.html, §3.1.2.4–3.1.2.5).

**[defect] Time-ordered data is split by time.** `KFold` and `ShuffleSplit`
assume independent samples; on time series they overlap train and test and
overstate generalisation. Use `TimeSeriesSplit` or a cut-off date, and do not
shuffle non-i.i.d. data
(https://scikit-learn.org/stable/modules/cross_validation.html, §3.1.2.6,
§3.1.3). A test set containing rows dated before the training rows is temporal
leakage (L3.1, https://arxiv.org/abs/2207.07048); Google's rule is to train on
data up to a date and test on data after it (Rule #33,
https://developers.google.com/machine-learning/guides/rules-of-ml).

**[defect] Every feature must be known at prediction time.** A feature that is
a proxy for the label, or is recorded after the outcome (Kapoor and
Narayanan's example: anti-hypertensive drug use as a feature for predicting
hypertension), is target leakage (L2, https://arxiv.org/abs/2207.07048). For
each new feature, ask when its value is written relative to the moment the
prediction is made.

**[defect] The test set is not used for tuning or model selection.** Tuning
hyperparameters against it leaks it into the model; tune with cross-validation
on the training portion and keep the test set for the final estimate
(https://scikit-learn.org/stable/modules/cross_validation.html, §3.1).

**[silence] A design states why the split and the features are legitimate.**
Kapoor and Narayanan's model info sheets ask for an argument per class: clean
separation, legitimacy of each feature, and a test distribution that matches
the claim (https://arxiv.org/abs/2207.07048).

## Reproducibility

Training twice on the same data should ideally give the same model; this is
what makes diff-testing a feature-code refactor possible. Seeding is not
enough on its own: initialisation order and thread or distributed data
ordering also vary (Infra 1,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[defect] Every random source is seeded explicitly.** In scikit-learn,
`random_state=None` is the default and changes results on every call; for
reproducible runs remove every `None`, pass one `RandomState` created at the
top of the program, and do not rely on `np.random.seed`
(https://scikit-learn.org/stable/common_pitfalls.html, §12.3). In PyTorch,
seed `torch.manual_seed`, `random` and NumPy separately, and give `DataLoader`
a `worker_init_fn` and a seeded `generator`, because it reseeds workers itself
(https://docs.pytorch.org/docs/stable/notes/randomness.html).

**[defect] CV splitters get integer seeds.** A `RandomState` instance passed to
`KFold(shuffle=True)` yields different folds on each `split` call, so two
models compared fold by fold were evaluated on different data
(https://scikit-learn.org/stable/common_pitfalls.html, §12.3.2).

**[defect] Training reads a pinned data version.** A training job that reads a
mutable table, a `latest` path or a live upstream signal produces a different
model next week with no code change. Sculley et al. call such inputs unstable
data dependencies and recommend a frozen, versioned copy until a new version
is vetted
(https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html).

**[defect] The environment is pinned with the code.** PyTorch does not promise
identical results across releases, commits, platforms, or CPU versus GPU
(https://docs.pytorch.org/docs/stable/notes/randomness.html). In a study of
863,878 GitHub notebooks, 13.72% declared dependencies at all, and only
24.11% ran without error and 4.03% reproduced their stored results
(http://www.ic.uff.br/~leomurta/papers/pimentel2019a.pdf). Lock-file review
itself is `supply-chain-review`.

**[trade-off] Integer seed or `RandomState` in estimators under CV.** An
integer gives identical randomness on every fold and exact clones; an instance
gives each fold different randomness, which scikit-learn prefers for robust CV
estimates and which avoids treating the seed as a tuned hyperparameter
(https://scikit-learn.org/stable/common_pitfalls.html, §12.3.2–12.3.3).

## Nondeterminism in GPU kernels

`torch.backends.cudnn.benchmark = True` lets cuDNN pick convolution algorithms
by timing, which varies between runs; `cudnn.deterministic = True` fixes only
the convolution algorithm; `torch.use_deterministic_algorithms(True)` selects
deterministic implementations everywhere and raises `RuntimeError` for ops
that have none (for example CUDA `index_add_`), unless `warn_only=True`
downgrades that to a warning
(https://docs.pytorch.org/docs/stable/notes/randomness.html,
https://docs.pytorch.org/docs/stable/generated/torch.use_deterministic_algorithms.html).
cuBLAS is bitwise reproducible only on the same architecture and SM count,
within one toolkit version, and with one active stream unless
`CUBLAS_WORKSPACE_CONFIG` is `:16:8` or `:4096:8`; atomics mode is never
bitwise reproducible (cuBLAS docs, "Results reproducibility",
https://docs.nvidia.com/cuda/cublas/index.html).

**[defect] A test that asserts exact equality of GPU results enables
deterministic mode.** Without it the test is flaky by construction; with
`warn_only=True` it is still not deterministic. Tests that compare across
hardware or library versions should compare within a tolerance instead.

**[trade-off] Deterministic kernels vs speed.** Options: deterministic mode on
in training (diff-testable runs, slower; some ops raise) | on only in tests and
debugging (fast production training, runs not comparable bitwise) | off with
tolerance-based comparisons (fastest, only statistical reproducibility).

## Training-serving skew

**[defect] One feature definition serves both training and serving.** Separate
implementations — a flexible offline version and an optimised online one, or a
backfill computed by another code path — diverge (Monitor 3,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).
Reuse code between the two pipelines; different languages make that much
harder (Rule #32,
https://developers.google.com/machine-learning/guides/rules-of-ml). Where two
paths must exist, a parity test feeds the same rows through both.

**[defect] Fitted preprocessing ships with the model.** A transform fitted in
training and not applied at prediction time changes the feature space; in
scikit-learn's example the test MSE was 62.80 without the scaler and 0.90 with
it. Package the transform and estimator as one `Pipeline` artifact
(https://scikit-learn.org/stable/common_pitfalls.html, §12.1).

**[defect] Lookups joined at serving time match what training saw.** A table
joined in both places can change between training and serving; logging the
features actually used at serving and training on those logs removes the gap,
snapshotting the table narrows it (Rules #29 and #31,
https://developers.google.com/machine-learning/guides/rules-of-ml).

**[defect] Inference runs in eval mode.** Dropout and BatchNorm behave
differently in training mode, and BatchNorm updates its running statistics on
whatever it sees. `model.eval()` is separate from `torch.no_grad()` /
`torch.inference_mode()`; serving code needs both
(https://docs.pytorch.org/docs/stable/notes/autograd.html).

**[silence] The design says how skew is measured.** Log a sample of serving
traffic with example identifiers and compare feature values, or compare
distribution statistics (min, max, mean, missing fraction) between training
and serving (Monitor 3,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/;
Rule #37, https://developers.google.com/machine-learning/guides/rules-of-ml).

**[trade-off] How to keep features identical.** Options: log served features
and train on the logs (no skew by construction, needs logging before a feature
can be trained on) | one shared feature library (no new logging, both paths
must run the same language) | snapshot joined tables (cheap, closes the gap
only partly) (Rules #29, #31, #32,
https://developers.google.com/machine-learning/guides/rules-of-ml).

## Data validation and schema

**[defect] Inputs are checked against a schema before training and at
serving.** Encode expectations (types, ranges, categorical values,
distributions) and check both training and serving inputs against them (Data 1,
Monitor 2,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).
TFDV computes statistics, infers a schema and reports anomalies
(https://www.tensorflow.org/tfx/guide/tfdv); Great Expectations runs
Expectation-based Validation Definitions from a Checkpoint
(https://docs.greatexpectations.io/docs/core/trigger_actions_based_on_results/create_a_checkpoint_with_actions/).

**[defect] An inferred schema is reviewed and checked in.** TFDV calls its
inferred schema best-effort and expects it to be reviewed, edited and kept in
version control (https://www.tensorflow.org/tfx/guide/tfdv).

**[defect] A failed validation stops the run.** A check whose only outcome is a
notification lets training or export continue on bad data. Great Expectations
Actions fire on results (`notify_on: failure`); halting is the calling code's
job, so check the code reads the result and stops (the exact result field was
not confirmed in the 1.x docs opened).

**[defect] Training-only fields are declared as such.** A label or other
training-only column is excluded from the serving schema with TFDV
environments (`default_environment`, `not_in_environment`), not by disabling
the check (https://www.tensorflow.org/tfx/data_validation/get_started).

**[defect] Feature code has unit tests.** A bug in feature generation that
reaches both training and test data is almost impossible to detect later
(Data 7,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

## Evaluation hygiene

**[defect] A new model is compared with a simple baseline.** A linear model
with few features checks the pipeline and prices the extra complexity (Model 5,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).
In Kapoor and Narayanan's civil-war case study, complex models no longer beat
logistic regression once leakage was fixed (https://reproducible.cs.princeton.edu/).

**[defect] A claim that one model is better carries a significance test that
accounts for shared folds.** Scores on the same CV splits are correlated;
treating them as independent inflates false positives. In scikit-learn's
example an uncorrected t-test gave p = 0.005 and the Nadeau–Bengio corrected
test p = 0.227; comparisons across several models also need a
multiple-comparison correction such as Bonferroni. A non-significant result is
not evidence of equivalence
(https://scikit-learn.org/stable/auto_examples/model_selection/plot_grid_search_stats.html).

**[defect] Quality is reported per slice, not only in aggregate.** Slice by
dimensions that may behave differently (country, frequency of use, protected
groups) and check whether predictions differ materially across groups (Model 6,
Model 7,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[defect] Decision thresholds are re-derived when the model changes.** A
hand-set threshold tuned for one model is invalid for the next; learn it on
held-out data as part of training (Sculley et al., "Fixed Thresholds in
Dynamic Systems",
https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html).

**[silence] The offline metric is tied to the product metric.** A design states
how the loss or offline score relates to the online impact it is meant to
move, measured for example with a small A/B test of a deliberately degraded
model (Model 2,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[trade-off] Frequentist or Bayesian model comparison.** Options: corrected
paired t-test (answers "is A better", needs a multiple-comparison correction,
cannot show equivalence) | Bayesian posterior with a region of practical
equivalence (gives better/worse/equivalent probabilities, needs a chosen ROPE
width)
(https://scikit-learn.org/stable/auto_examples/model_selection/plot_grid_search_stats.html).

## Model versioning and lineage

**[defect] Every artifact is versioned and traceable to its run.** A model
written to a fixed path (`model.pkl`, `latest/`) overwrites the previous one
and loses which code, data and parameters made it. A registry gives each
registration a new version linked to the run that produced it, and a mutable
alias (`models:/MyModel@champion`) for what serves
(https://mlflow.org/docs/latest/ml/model-registry/).

**[defect] Model specifications and training configs are reviewed and checked
in.** Configuration can outgrow the code, and each line can be wrong; it
should be diffable between models and asserted on automatically (Sculley et
al., "Configuration Debt",
https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html;
Model 1,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[defect] Checkpoints are loaded without executing code.** `torch.load` runs
pickle; since 2.6 it defaults to `weights_only=True`. Passing
`weights_only=False`, or saving a whole module instead of a `state_dict`, is
acceptable only for files from a trusted source
(https://docs.pytorch.org/docs/stable/notes/serialization.html). This item goes
to `security-reviewer`.

**[silence] Consumers of the model's output are declared.** Undeclared
consumers couple other systems to the model silently and make any change,
including an improvement, risky (Sculley et al.,
https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html).

## Model rollout

**[defect] An automated gate blesses or vetoes a model before it serves.**
Compare with the previous version under tight thresholds to catch sudden
drops, and with a validation set under loose thresholds to catch slow decay
(Infra 4,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/;
Rule #9, https://developers.google.com/machine-learning/guides/rules-of-ml).

**[defect] The artifact is loaded by the production serving binary before
rollout.** Modelling code changes faster than serving code; a model trained
with a newer op implementation can fail to load in an older server. Test that
it loads and serves production inputs, then raise traffic gradually (Infra 6,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[defect] The previous model stays deployable.** Rolling back the learned
model, not the code, is the ML-specific incident response, so the previous
version must remain loadable and selectable (Infra 7,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/);
with a registry this is reassigning the serving alias
(https://mlflow.org/docs/latest/ml/model-registry/).

**[silence] The rollback is practised.** Operators should rehearse it outside
emergencies (Infra 7,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[trade-off] Shadow, canary or direct cut-over.** Options: shadow (copy of live
requests to the new model, only the production model's response returned —
measures latency, errors and output differences with no user impact, but not
user outcomes,
https://docs.aws.amazon.com/sagemaker/latest/dg/shadow-tests.html) | canary
(small, growing traffic share — measures real outcomes, exposes some users to
a bad model, Infra 6) | direct swap with fast rollback (simplest, every user
exposed until rollback).

## Monitoring for drift and staleness

**[defect] Input data is monitored, not only the service.** Stale tables and
dropping feature coverage degrade a model without errors (Rule #10,
https://developers.google.com/machine-learning/guides/rules-of-ml). Compare
serving inputs with the schema and training statistics (Monitor 2,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/);
TFDV's `skew_comparator` and `drift_comparator` use L-infinity distance for
categorical features and Jensen–Shannon divergence for numeric ones, with
thresholds tuned iteratively (https://www.tensorflow.org/tfx/guide/tfdv,
https://www.tensorflow.org/tfx/data_validation/get_started).

**[silence] Freshness requirements and model age are stated.** Measure how fast
quality decays with model age and alert on the age of the serving model and of
every feature table it reads (Rule #8,
https://developers.google.com/machine-learning/guides/rules-of-ml; Monitor 4,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[silence] Prediction quality on served data has a measure.** Options include
prediction bias (predicted vs observed label distribution, sliced), action
limits on systems that act in the world, and human-labelled samples of served
inputs (Sculley et al.,
https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html;
Monitor 7,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[silence] Upstream changes and feedback loops are named.** A design lists the
upstream producers whose changes must notify the team (Monitor 1) and whether
the model's outputs influence its own future training data, directly or
through another system (Sculley et al., "Feedback Loops",
https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html).

## Numerical stability

**[defect] Training detects the first NaN or infinity.** Invalid values can
appear without an error; monitor their first occurrence and set bounds on
weights and dead-unit fractions (Monitor 5,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[defect] float16 autocast uses gradient scaling.** Small float16 gradients
underflow to zero; `GradScaler` scales the loss, and `scaler.step` skips
`optimizer.step()` when gradients contain infs or NaNs. Clip gradients only
after `scaler.unscale_(optimizer)`. `autocast` wraps the forward pass and loss,
not backward. `binary_cross_entropy` raises under autocast; use
`binary_cross_entropy_with_logits`. Models pretrained in bfloat16 can overflow
in float16 (https://docs.pytorch.org/docs/stable/amp.html,
https://docs.pytorch.org/docs/stable/notes/amp_examples.html).

**[trade-off] TF32 matmul precision.** On Ampere and later GPUs TF32 ran about
7× faster than FP32 in PyTorch's A100 example with roughly 100× the relative
error; cuDNN TF32 is on by default, matmul TF32 off since 1.12
(https://docs.pytorch.org/docs/stable/notes/cuda.html). Options: TF32 on
(speed) | IEEE FP32 (accuracy, needed when results are compared tightly).

## GPU and memory

**[defect] Inference disables autograd recording.** Outside `torch.no_grad()`
or `torch.inference_mode()`, operations are recorded in the backward graph
(https://docs.pytorch.org/docs/stable/notes/autograd.html).

**[defect] `torch.cuda.empty_cache()` is not used as an out-of-memory fix.** It
releases cached blocks to other processes but frees nothing held by live
tensors; `memory_allocated()` counts tensors, `memory_reserved()` the whole
cache, and `nvidia-smi` shows the cache as used
(https://docs.pytorch.org/docs/stable/notes/cuda.html). An OOM fix finds the
references keeping tensors alive.

**[defect] GPU timings synchronise.** Kernels run asynchronously; timing
without `torch.cuda.synchronize()` or CUDA events measures launch, not work,
and asynchronous errors surface after the faulting call
(`CUDA_LAUNCH_BLOCKING=1` to locate them)
(https://docs.pytorch.org/docs/stable/notes/cuda.html).

**[silence] Compute regressions are tracked per model version.** Training
speed, serving latency, throughput and RAM, sliced by data and model version
as well as code version (Monitor 6,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[trade-off] Allocator fragmentation.** Options: `expandable_segments:True`
in `PYTORCH_ALLOC_CONF` (helps when batch shapes vary, experimental) |
`max_split_size_mb` (a last resort for many inactive split blocks, costs
performance) | fixed or bucketed input shapes (no allocator change, constrains
the data path) (https://docs.pytorch.org/docs/stable/notes/cuda.html).

## Personal data in training data

Training, validation and vocabulary files can carry personal data, and export
and transformation bugs leak it; access to pipeline data should be as tight as
access to the raw data, and a user's deletion request should reach the
training data and any learned model (Data 5,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).
The checks themselves are `privacy-review`'s: `privacy:new-purpose-reader`
(production records reused for training), `privacy:deletion-misses-copy`
(training sets and snapshots as copies), `privacy:real-data-in-fixtures`
(sample datasets in tests and notebooks). Whether a trained model counts as a
copy that a deletion must reach is a legal question for the owner.

## Notebook to production

In the notebook study above, 36.36% of notebooks with an unambiguous execution
order had cells run out of order, and 12.59% failed on missing files from
absolute paths or data not in the repository; hidden state from re-executed or
edited cells is a further cause of irreproducible results
(http://www.ic.uff.br/~leomurta/papers/pimentel2019a.pdf). Sculley et al. name
the related system smells: a prototype environment used as production, glue
code, and dead experimental code paths
(https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html).

**[defect] Promoted code runs top to bottom from a clean process.** Code lifted
from a notebook must not rely on variables defined in cells that were not
copied, on cell order, or on interactive state.

**[defect] No absolute paths or notebook-only globals survive promotion.**
Absolute data paths were the cause of the study's file errors above; paths and
parameters come from configuration that is checked in and reviewed (Sculley
et al., "Configuration Debt").

**[defect] Promoted pipeline code has tests.** Feature code needs unit tests
(Data 7), model specification code unit tests (Infra 2), and the whole
pipeline an integration test (Infra 3,
https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/).

**[defect] Experiments do not pile up as conditional branches in production
code.** Accumulated experimental paths grow complexity until their
interactions cannot all be tested; delete a branch once its experiment ends
(Sculley et al., "Dead Experimental Codepaths",
https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html).

## Related

- `ai-feature-review` — application code calling an LLM API, prompts, evals of
  model output.
- `privacy-review` — personal data in training sets, deletion, fixtures.
- `supply-chain-review` — lock files and pinned dependencies.
- `python-testing` — pytest structure for the tests this file asks for.
- `observability-patterns` — the metrics and alerts drift monitoring uses.
- `ops-readiness` — rollout, rollback and on-call for a new serving endpoint.
- `resilience-patterns` — timeouts and retries on the serving path.

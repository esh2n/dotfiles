# ml-pipeline-review — review checklist

Derived from ../SKILL.md. Read by `code-reviewer`, `test-reviewer` and `rollout-reviewer` through the `change-review` skill when a diff touches training or evaluation code, feature pipelines, datasets or splits, model artifacts or registries, notebooks promoted to code, or model serving (defects in a diff; silences and trade-offs in a design or spec review) — and by `grilling` (trade-offs). Evaluation, reproducibility, GPU determinism and validation-test items go to `test-reviewer`; versioning, rollout, rollback and monitoring items to `rollout-reviewer`; the rest to `code-reviewer`. `ml:unsafe-checkpoint-load` goes to `security-reviewer`. LLM API features are `ai-feature-review`; personal data in training data is `privacy-review`'s checklist. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: ml:fit-before-split
  rule: Split before any fitted preprocessing; fit transforms on training rows only.
  check: `fit`/`fit_transform` of a scaler, imputer, PCA, feature selector or over/under-sampler on a frame that still contains test or validation rows; preprocessing outside a `Pipeline` passed to cross-validation or a hyperparameter search.
  section: "## Data leakage"

- id: ml:rows-straddle-split
  rule: Duplicates and rows from the same patient, user or unit never land on both sides of the split.
  check: `train_test_split`, `KFold` or `ShuffleSplit` on data with a repeated entity id and no `groups`/`GroupKFold`/`GroupShuffleSplit`; no de-duplication before the split.
  section: "## Data leakage"

- id: ml:time-split-shuffled
  rule: Time-ordered data is split by time, never shuffled.
  check: Shuffled split, `KFold(shuffle=True)` or random `train_test_split` on timestamped or sequential data; a test set with rows dated before training rows; no `TimeSeriesSplit` or cut-off date.
  section: "## Data leakage"

- id: ml:feature-unavailable-at-prediction
  rule: Every feature is known at the moment the prediction is made.
  check: New feature derived from the label, written after the outcome, or aggregated over a window that ends after the prediction timestamp.
  section: "## Data leakage"

- id: ml:test-set-tuned
  rule: The test set is not used for tuning or model selection.
  check: Hyperparameter search, early stopping, threshold selection or model choice scored on the final test set.
  section: "## Data leakage", "## Evaluation hygiene"

- id: ml:unseeded-randomness
  rule: Every random source is seeded explicitly.
  check: `random_state=None` (or omitted) in a run meant to be reproducible; `np.random.seed` as the only seed; PyTorch training without `torch.manual_seed`, `random` and NumPy seeds; `DataLoader` with workers and no `worker_init_fn`/seeded `generator`.
  section: "## Reproducibility"

- id: ml:splitter-instance-seed
  rule: CV splitters get integer seeds.
  check: `KFold(shuffle=True)` or another splitter given a `RandomState` instance or `None` while models are compared fold by fold.
  section: "## Reproducibility"

- id: ml:unpinned-data-version
  rule: Training reads a pinned data version.
  check: Training input addressed by a mutable table, `latest` path, live upstream signal or unversioned bucket prefix, with no snapshot id, dataset version or hash recorded with the model.
  section: "## Reproducibility"

- id: ml:unpinned-environment
  rule: The training and serving environment is pinned with the code.
  check: New training or serving code with no lock file or pinned framework/CUDA versions; notebook promoted with imports not declared anywhere. Lock-file quality itself is `supply-chain-review`.
  section: "## Reproducibility"

- id: ml:gpu-exact-assert-nondeterministic
  rule: A test asserting exact equality of GPU results enables deterministic mode; cross-hardware comparisons use a tolerance.
  check: Bitwise/`==`/`assert_equal` on GPU training or inference outputs without `torch.use_deterministic_algorithms(True)` (not `warn_only=True`), `cudnn.benchmark=False` and `CUBLAS_WORKSPACE_CONFIG` set; exact comparison across devices or library versions.
  section: "## Nondeterminism in GPU kernels"

- id: ml:duplicate-feature-definition
  rule: One feature definition serves both training and serving, or a parity test pins two definitions together.
  check: Same feature computed in a training script and reimplemented in serving code (or a backfill path) with no shared module and no test feeding the same rows through both.
  section: "## Training-serving skew"

- id: ml:preprocessing-not-shipped
  rule: Fitted preprocessing ships with the model.
  check: Serialised estimator without its fitted scaler/encoder/vocabulary; serving code that refits or re-creates a transform instead of loading the trained one.
  section: "## Training-serving skew"

- id: ml:serving-join-drift
  rule: Lookups joined at serving time match what training saw.
  check: Serving joins a table that training read at a different time, with no logged serving features and no snapshot.
  section: "## Training-serving skew"

- id: ml:inference-train-mode
  rule: Inference runs in eval mode.
  check: PyTorch serving or evaluation path with Dropout/BatchNorm and no `model.eval()`; `no_grad` used as if it set eval mode.
  section: "## Training-serving skew"

- id: ml:no-input-schema-check
  rule: Inputs are checked against a schema before training and at serving.
  check: New pipeline or feature with no TFDV, Great Expectations or equivalent check on types, ranges, categories or missing fraction before training, or none on serving inputs.
  section: "## Data validation and schema"

- id: ml:schema-unreviewed
  rule: An inferred schema is reviewed and checked in.
  check: Schema re-inferred on every run from current data, or inferred and never committed.
  section: "## Data validation and schema"

- id: ml:validation-non-blocking
  rule: A failed validation stops the run.
  check: Validation whose result is only logged or sent as a notification while training, export or deployment continues.
  section: "## Data validation and schema"

- id: ml:training-only-field-undeclared
  rule: Training-only fields are declared as such, not hidden by disabling the check.
  check: Label column missing at serving handled by turning off the schema check instead of an environment (`not_in_environment`) or equivalent.
  section: "## Data validation and schema"

- id: ml:feature-code-untested
  rule: Feature code has unit tests.
  check: New or changed feature transformation with no unit test.
  section: "## Data validation and schema"

- id: ml:no-baseline
  rule: A new model is compared with a simple baseline.
  check: Evaluation reports the new model with no linear/few-feature or current-production baseline beside it.
  section: "## Evaluation hygiene"

- id: ml:comparison-without-significance
  rule: A claim that one model is better carries a significance test that accounts for shared folds.
  check: "Better" decided from mean CV scores alone, an uncorrected t-test on fold scores, or several pairwise comparisons with no multiple-comparison correction; a non-significant result reported as equivalence.
  section: "## Evaluation hygiene"

- id: ml:aggregate-only-metric
  rule: Quality is reported per slice, not only in aggregate.
  check: Evaluation output or promotion gate with one overall metric and no slices by the dimensions or groups the design names.
  section: "## Evaluation hygiene"

- id: ml:fixed-threshold
  rule: Decision thresholds are re-derived when the model changes.
  check: Hard-coded decision threshold in serving code or config that a retrain does not recompute on held-out data.
  section: "## Evaluation hygiene"

- id: ml:artifact-unversioned
  rule: Every artifact is versioned and traceable to its run.
  check: Model written to a fixed path (`model.pkl`, `latest/`) that overwrites the previous one; no recorded code commit, data version and parameters; serving loads by mutable path without logging the version it loaded.
  section: "## Model versioning and lineage"

- id: ml:config-unreviewed
  rule: Model specifications and training configs are reviewed and checked in.
  check: Training parameters passed only on a command line, in a notebook cell or an untracked file.
  section: "## Model versioning and lineage"

- id: ml:unsafe-checkpoint-load
  rule: Checkpoints are loaded without executing code.
  check: `torch.load(..., weights_only=False)`, `pickle.load`/`joblib.load` of a file not produced by a trusted pipeline, or a whole module saved instead of a `state_dict`.
  section: "## Model versioning and lineage"

- id: ml:no-quality-gate
  rule: An automated gate blesses or vetoes a model before it serves.
  check: Training job that publishes or deploys its output with no comparison against the previous version and a validation set.
  section: "## Model rollout"

- id: ml:artifact-not-load-tested
  rule: The artifact is loaded by the production serving binary before rollout.
  check: Rollout path with no step that loads the new artifact in the serving image and runs production-shaped inputs; training and serving framework versions changed independently.
  section: "## Model rollout"

- id: ml:previous-model-not-deployable
  rule: The previous model stays deployable.
  check: Deployment that deletes or overwrites the prior artifact, or has no switch (alias, version pin, config) to send traffic back to it.
  section: "## Model rollout"

- id: ml:input-data-unmonitored
  rule: Input data is monitored, not only the service.
  check: New model in serving with no comparison of serving inputs against the schema or training statistics (skew/drift comparators or equivalent).
  section: "## Monitoring for drift and staleness"

- id: ml:nan-undetected
  rule: Training detects the first NaN or infinity.
  check: Training loop with no check or alert on NaN/inf loss, gradients or weights.
  section: "## Numerical stability"

- id: ml:fp16-without-scaling
  rule: float16 autocast uses gradient scaling, correctly ordered.
  check: CUDA float16 `autocast` training without `GradScaler`; gradient clipping before `scaler.unscale_`; backward inside `autocast`; `binary_cross_entropy` under autocast.
  section: "## Numerical stability"

- id: ml:inference-autograd-on
  rule: Inference disables autograd recording.
  check: PyTorch serving or batch-inference path outside `torch.no_grad()`/`torch.inference_mode()`.
  section: "## GPU and memory"

- id: ml:empty-cache-as-oom-fix
  rule: `torch.cuda.empty_cache()` is not an out-of-memory fix.
  check: `empty_cache()` added to fix OOM in the same process while references to tensors (loss histories, outputs kept across iterations) remain.
  section: "## GPU and memory"

- id: ml:unsynchronized-gpu-timing
  rule: GPU timings synchronise.
  check: Wall-clock timing of GPU work with no `torch.cuda.synchronize()` or CUDA events, used for a benchmark or performance claim.
  section: "## GPU and memory"

- id: ml:notebook-hidden-state
  rule: Promoted code runs top to bottom from a clean process.
  check: Code lifted from a notebook that uses names defined in cells not copied, depends on cell order, or was never run as a script or test from a fresh process.
  section: "## Notebook to production"

- id: ml:notebook-absolute-paths
  rule: No absolute paths or notebook-only globals survive promotion.
  check: Absolute or user-specific data paths, or parameters set as notebook globals, in promoted code instead of checked-in configuration.
  section: "## Notebook to production"

- id: ml:promoted-code-untested
  rule: Promoted pipeline code has tests.
  check: Feature, model-specification or pipeline code moved out of a notebook with no unit test or integration test.
  section: "## Notebook to production"

- id: ml:dead-experimental-paths
  rule: Experiments do not pile up as conditional branches in production code.
  check: New experiment flag or branch in production training/serving code with no removal plan, or branches left for experiments that have ended.
  section: "## Notebook to production"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: ml:leakage-argument-unstated
  rule: The design argues clean separation, legitimacy of each feature, and a test distribution matching the claim.
  check: Design with a split or feature list and no stated reasoning for groups, time order or when each feature is known.
  section: "## Data leakage"

- id: ml:skew-measure-unstated
  rule: The design says how training-serving skew is measured.
  check: Design with a serving path and no logging of serving features or comparison of training and serving statistics.
  section: "## Training-serving skew"

- id: ml:offline-online-link-unstated
  rule: The offline metric is tied to the product metric.
  check: Design that promotes on an offline score with no stated relation to the online metric it should move.
  section: "## Evaluation hygiene"

- id: ml:consumers-undeclared
  rule: Consumers of the model's output are declared.
  check: Prediction output written to a shared table, topic or API with no list of consumers or access control.
  section: "## Model versioning and lineage"

- id: ml:rollback-unpractised
  rule: The rollback is practised.
  check: Rollback described with no drill or record of having been exercised outside an incident.
  section: "## Model rollout"

- id: ml:freshness-unstated
  rule: Freshness requirements and model age are stated.
  check: No stated tolerable model age, retrain cadence, or alert on the age of the model and of the feature tables it reads.
  section: "## Monitoring for drift and staleness"

- id: ml:served-quality-unmeasured
  rule: Prediction quality on served data has a measure.
  check: No prediction-bias check, action limit, delayed-label evaluation or labelled sample of served inputs.
  section: "## Monitoring for drift and staleness"

- id: ml:upstream-and-feedback-unstated
  rule: Upstream producers and feedback loops are named.
  check: Design with upstream data sources and no notification arrangement, or a model whose outputs shape its future training data with no mention of it.
  section: "## Monitoring for drift and staleness"

- id: ml:compute-regression-untracked
  rule: Compute regressions are tracked per model version.
  check: No training speed, serving latency, throughput or memory tracking sliced by model and data version.
  section: "## GPU and memory"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: ml:estimator-seed-int-or-instance
  rule: Integer seed vs `RandomState` instance in estimators under cross-validation.
  options: integer (identical randomness per fold, exact clones, risk of a lucky seed) | instance or None per fold (robust CV estimate, clones share an RNG, runs differ unless the top-level RNG is seeded)
  section: "## Reproducibility"

- id: ml:deterministic-kernels
  rule: Deterministic GPU kernels vs speed.
  options: deterministic in training (diff-testable runs, slower, some ops raise) | deterministic only in tests and debugging (fast training, production runs not bitwise comparable) | off with tolerance comparisons (fastest, statistical reproducibility only)
  section: "## Nondeterminism in GPU kernels"

- id: ml:feature-parity-method
  rule: How to keep training and serving features identical.
  options: log served features and train on the logs (no skew by construction, a feature must be logged before it can be trained on) | shared feature library (no new logging, both paths in one language) | snapshot joined tables (cheap, closes the gap only partly)
  section: "## Training-serving skew"

- id: ml:comparison-test-kind
  rule: Frequentist vs Bayesian model comparison.
  options: corrected paired t-test (answers "is A better", needs multiple-comparison correction, cannot show equivalence) | Bayesian posterior with ROPE (better/worse/equivalent probabilities, needs a chosen ROPE width)
  section: "## Evaluation hygiene"

- id: ml:rollout-shadow-canary-direct
  rule: Shadow, canary or direct cut-over for a new model.
  options: shadow (no user impact, measures latency/errors/output differences, not user outcomes) | canary (real outcomes, some users see a bad model) | direct swap with fast rollback (simplest, every user exposed until rollback)
  section: "## Model rollout"

- id: ml:tf32-precision
  rule: TF32 vs IEEE FP32 for matmul and convolution.
  options: TF32 (several times faster on Ampere+, about two orders of magnitude more relative error) | IEEE FP32 (accuracy for tight comparisons, slower)
  section: "## Numerical stability"

- id: ml:allocator-fragmentation
  rule: How to handle CUDA allocator fragmentation.
  options: expandable_segments (helps varying shapes, experimental) | max_split_size_mb (last resort, costs performance) | fixed or bucketed shapes (no allocator change, constrains the data path)
  section: "## GPU and memory"

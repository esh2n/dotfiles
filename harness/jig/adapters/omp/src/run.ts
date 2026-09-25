/**
 * Running one external command, the way both the formatter and the gate need
 * it: never throwing, always bounded, and able to say "that program is not
 * installed" apart from "that program said no".
 *
 * The port and its `execFile` adapter are jig's own
 * (`src/domain/hooks/run.ts`, `src/infra/proc/exec-file.ts`) — this module is
 * the omp-facing name for them, kept so the adapter's own code and tests read
 * in omp's vocabulary rather than reaching across the tree for a type.
 */

export type { ChangedFiles } from "../../../src/domain/hooks/changed";
export type { RunResult as CommandResult, Runner } from "../../../src/domain/hooks/run";
export { changedFiles } from "../../../src/infra/proc/changed-files";
export { runCommand } from "../../../src/infra/proc/exec-file";

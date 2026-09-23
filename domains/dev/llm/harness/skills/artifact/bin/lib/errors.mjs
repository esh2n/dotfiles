// errors.mjs — the one error type the CLI throws, plus the exit-code table.
//
// Same split as the Worker's http.mjs: `message` is user-facing prose, while
// anything diagnostic travels in `detail` and is only shown with --json or on
// stderr. Every refusal carries the exit code the caller (a hook, a cron job)
// branches on, so the code is decided where the refusal happens, never guessed
// by the dispatcher.

export const EXIT = Object.freeze({
  ok: 0,
  usage: 1,
  network: 2,
  external: 3,
  secret: 4,
  size: 5,
});

export class CliError extends Error {
  constructor(exitCode, code, message, detail = null) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.code = code;
    this.detail = detail;
  }
}

export const usageError = (code, message, detail = null) => new CliError(EXIT.usage, code, message, detail);
export const networkError = (code, message, detail = null) => new CliError(EXIT.network, code, message, detail);
export const externalError = (code, message, detail = null) => new CliError(EXIT.external, code, message, detail);
export const secretError = (code, message, detail = null) => new CliError(EXIT.secret, code, message, detail);
export const sizeError = (code, message, detail = null) => new CliError(EXIT.size, code, message, detail);

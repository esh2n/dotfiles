import type { Logger } from "../../domain/ports";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Readonly<Record<Level, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Logger port backed by stderr, so stdout stays clean for hook JSON output. */
export class ConsoleLogger implements Logger {
  constructor(private readonly minLevel: Level = "info") {}

  private emit(level: Level, message: string, meta?: Record<string, unknown>): void {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const line = meta ? `${level} ${message} ${JSON.stringify(meta)}` : `${level} ${message}`;
    process.stderr.write(`${line}\n`);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.emit("debug", message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.emit("info", message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit("warn", message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.emit("error", message, meta);
  }
}

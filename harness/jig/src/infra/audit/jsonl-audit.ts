/**
 * The audit log as a jsonl file, appended one line per judgment. Same
 * technique as the router log: `appendFile` is atomic for lines this size,
 * the directory is created on first use, and a launchd stdout would rotate
 * away while a file append does not.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditEntry } from "../../domain/policy/audit";
import type { AuditLog } from "../../domain/ports";

export class JsonlAuditLog implements AuditLog {
  constructor(private readonly path: string) {}

  async append(entry: AuditEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

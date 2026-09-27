/**
 * Starting a worker process with `node:child_process` (the harnesses embed
 * their own runtimes; see `infra/proc/exec-file.ts`). No shell: the task is
 * one argument, never parsed as a command line. stdout is split into lines;
 * stderr keeps only its last few KB, for the failure message.
 */

import { spawn as nodeSpawn } from "node:child_process";
import type { Spawn, WorkerProcess } from "../../app/swarm/ports";

const STDERR_TAIL = 2048;
const KILL_GRACE_MS = 5_000;

export const spawnWorker: Spawn = (bin, args, options): WorkerProcess => {
  const child = nodeSpawn(bin, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let pending = "";
  let stderr = "";
  let exited = false;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    let at = pending.indexOf("\n");
    while (at !== -1) {
      const line = pending.slice(0, at).replace(/\r$/, "");
      pending = pending.slice(at + 1);
      if (line !== "") options.onLine(line);
      at = pending.indexOf("\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });

  const finish = (code: number | null) => {
    if (exited) return;
    exited = true;
    if (pending !== "") options.onLine(pending);
    options.onExit(code, stderr.trim().split("\n").slice(-5).join("\n"));
  };
  child.on("close", (code) => finish(code));
  child.on("error", (error) => {
    stderr += `\n${error.message}`;
    finish(127);
  });

  return {
    kill() {
      if (exited || child.killed) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!exited) child.kill("SIGKILL");
      }, KILL_GRACE_MS).unref();
    },
  };
};

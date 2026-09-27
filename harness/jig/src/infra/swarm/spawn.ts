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
    // The whole environment, on purpose: a worker is the same harness the
    // parent runs, with the same tools and the same guard, and it needs the
    // same keys to reach LiteLLM. It is given nothing the parent session
    // could not already use itself.
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    // its own process group, so stopping it stops what it started too (the
    // worker's harness runs tools as children of its own)
    detached: true,
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

  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      // the group is gone already; fall back to the process itself
      child.kill(signal);
    }
  };

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
      if (exited) return;
      signalGroup("SIGTERM");
      setTimeout(() => {
        if (!exited) signalGroup("SIGKILL");
      }, KILL_GRACE_MS).unref();
    },
  };
};

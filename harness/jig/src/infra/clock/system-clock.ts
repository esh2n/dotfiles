import type { Clock } from "../../domain/ports";

/** Clock port backed by the wall clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

import { coefontAdapter } from "./coefont";
import { sayAdapter } from "./say";
import type { VoiceAdapter } from "./types";
import { voicevoxAdapter } from "./voicevox";

export const ADAPTERS: Record<string, VoiceAdapter> = {
  voicevox: voicevoxAdapter,
  coefont: coefontAdapter,
  say: sayAdapter,
};

export type { SynthesisResult, VoiceAdapter } from "./types";

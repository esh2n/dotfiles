import { describe, expect, it } from "vitest";
import { wavDurationSec } from "./wav";

/** 最小構成のPCM WAVバッファを合成する */
function makeWav(opts: { sampleRate: number; seconds: number; channels?: number; bits?: number }): Buffer {
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const byteRate = opts.sampleRate * channels * (bits / 8);
  const dataSize = Math.round(byteRate * opts.seconds);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(opts.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * (bits / 8), 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize)]);
}

describe("wavDurationSec", () => {
  it("computes duration from data size and byte rate", () => {
    expect(wavDurationSec(makeWav({ sampleRate: 24000, seconds: 2.5 }))).toBeCloseTo(2.5, 3);
    expect(wavDurationSec(makeWav({ sampleRate: 44100, seconds: 0.5, channels: 2 }))).toBeCloseTo(0.5, 3);
  });

  it("rejects non-WAV buffers", () => {
    expect(() => wavDurationSec(Buffer.from("not a wav file at all"))).toThrow(/RIFF/);
  });

  it("handles extra chunks before data", () => {
    const wav = makeWav({ sampleRate: 24000, seconds: 1 });
    // fmt と data の間にLISTチャンクを挿入
    const list = Buffer.alloc(8 + 4);
    list.write("LIST", 0, "ascii");
    list.writeUInt32LE(4, 4);
    const patched = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);
    patched.writeUInt32LE(patched.length - 8, 4);
    expect(wavDurationSec(patched)).toBeCloseTo(1, 3);
  });
});

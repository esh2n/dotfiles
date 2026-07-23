/**
 * WAV(RIFF)ヘッダをパースして再生時間(秒)を返す。
 * 外部依存なし(python/ffprobe不要)でパイプラインを完結させるための実装。
 */
export function wavDurationSec(buf: Buffer): number {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }

  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let offset = 12;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      byteRate = buf.readUInt32LE(offset + 8 + 8);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }
    // チャンクは2バイト境界にパディングされる
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (byteRate === null || dataSize === null || byteRate === 0) {
    throw new Error("fmt/data chunk not found in WAV");
  }
  return dataSize / byteRate;
}

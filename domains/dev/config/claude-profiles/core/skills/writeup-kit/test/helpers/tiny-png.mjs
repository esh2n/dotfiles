// tiny-png.mjs — a from-scratch PNG encoder for kit fixtures, used both as
// a test fixture generator and to write kit/samples-assets/shot-sample.png
// (the kit is zero-dependency, so this hand-rolls PNG's chunk framing and
// CRC32 rather than pulling in an image library for one small raster).
//
// Format: 8-bit RGBA, no interlace, no palette, one IDAT holding every
// scanline deflated together (node:zlib does the deflate; PNG itself has
// no built-in CRC32, so that part is computed here by hand).

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/**
 * Encodes a minimal, valid `width` x `height` 8-bit RGBA PNG carrying a
 * simple two-tone pattern (the kit's own ink/surface tokens, left half vs.
 * right half of each row) — real enough to open in an image viewer, small
 * enough to embed as a fixture or ship inside the kit itself.
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function makeTinyPng(width = 64, height = 40) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: truecolor + alpha (RGBA)
  ihdr[10] = 0 // compression method
  ihdr[11] = 0 // filter method
  ihdr[12] = 0 // interlace method: none

  const ink = [0x1c, 0x22, 0x30]
  const surface = [0xf7, 0xf7, 0xf5]
  const stride = 1 + width * 4 // filter-type byte + 4 bytes/pixel
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride
    raw[rowStart] = 0 // filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = x < width / 2 ? ink : surface
      const off = rowStart + 1 + x * 4
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
      raw[off + 3] = 0xff
    }
  }

  const idat = deflateSync(raw)

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

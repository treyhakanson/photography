/**
 * Intrinsic image dimensions, read straight from the file header.
 *
 * A dependency would do the job, but every maintained option carries
 * advisories for malformed exotic formats, and reading five well-specified
 * headers is both smaller and auditable.
 *
 * Dimensions are the *stored* ones: EXIF orientation is deliberately ignored,
 * which is what the published layout was computed against.
 */
import { open } from "node:fs/promises";

export type Size = { width: number; height: number };

/** Enough for a JPEG's SOF marker even behind a fat EXIF/ICC block. */
const HEAD = 256 * 1024;

// Frame headers carrying dimensions. C4/C8/CC are tables, not frames.
const SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpeg(b: Buffer): Size | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }        // resync past padding
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }      // fill byte
    // Standalone markers: no length field follows.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (SOF.has(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function png(b: Buffer): Size | null {
  if (b.length < 24) return null;
  // Both PNG and the APNG/MNG variants put IHDR first.
  if (b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gif(b: Buffer): Size | null {
  if (b.length < 10) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webp(b: Buffer): Size | null {
  if (b.length < 30) return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    // 14 bits each, minus one, packed little-endian from byte 21.
    const bits = b.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X") {
    return {
      width: (b.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (b.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }
  return null;
}

function bmp(b: Buffer): Size | null {
  if (b.length < 26) return null;
  // Height is signed: negative means the rows are stored top-down.
  return { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) };
}

/** Read one image's dimensions, or throw with a reason the caller can print. */
export async function imageSize(path: string): Promise<Size> {
  const fh = await open(path, "r");
  let b: Buffer;
  try {
    const buf = Buffer.alloc(HEAD);
    const { bytesRead } = await fh.read(buf, 0, HEAD, 0);
    b = buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }

  let size: Size | null = null;
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) size = jpeg(b);
  else if (b.toString("hex", 0, 8) === "89504e470d0a1a0a") size = png(b);
  else if (b.toString("ascii", 0, 3) === "GIF") size = gif(b);
  else if (b.toString("ascii", 0, 4) === "RIFF" &&
           b.toString("ascii", 8, 12) === "WEBP") size = webp(b);
  else if (b.toString("ascii", 0, 2) === "BM") size = bmp(b);
  else throw new Error("unrecognized image header");

  if (!size) throw new Error("header present but no dimensions found");
  if (!size.width || !size.height) throw new Error("zero dimension");
  return size;
}

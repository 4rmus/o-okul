import { inflateSync } from "node:zlib";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const colorChannels = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);
const allowedBitDepths = new Map([
  [2, new Set([8])],
  [6, new Set([8])],
]);
const maxDecodedBytes = 256 * 1024 * 1024;

export function inspectPng(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(pngSignature)) return null;

  let offset = 8;
  let ihdr;
  let sawIend = false;
  const idatChunks = [];

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new Error("PNG chunk eksik.");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    const nextOffset = crcOffset + 4;
    if (nextOffset > bytes.byteLength) throw new Error(`PNG ${type || "chunk"} verisi eksik.`);

    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(bytes.subarray(offset + 4, crcOffset));
    if (actualCrc !== expectedCrc) throw new Error(`PNG ${type} CRC geçersiz.`);

    const data = bytes.subarray(dataStart, crcOffset);
    if (type === "IHDR") {
      if (ihdr || offset !== 8 || length !== 13) throw new Error("PNG IHDR ilk ve 13 bayt olmalı.");
      ihdr = readIhdr(data);
    } else if (type === "IDAT") {
      if (!ihdr || sawIend) throw new Error("PNG IDAT sırası geçersiz.");
      idatChunks.push(data);
    } else if (type === "IEND") {
      if (!ihdr || length !== 0 || sawIend) throw new Error("PNG IEND geçersiz.");
      sawIend = true;
      if (nextOffset !== bytes.byteLength) throw new Error("PNG IEND son chunk olmalı.");
    }
    offset = nextOffset;
  }

  if (!ihdr || idatChunks.length === 0 || !sawIend) throw new Error("PNG IHDR, IDAT ve IEND chunk'larını içermeli.");
  const channels = colorChannels.get(ihdr.colorType);
  const rowBytes = Math.ceil((ihdr.width * channels * ihdr.bitDepth) / 8);
  const expectedDecodedBytes = (rowBytes + 1) * ihdr.height;
  if (!Number.isSafeInteger(expectedDecodedBytes) || expectedDecodedBytes > maxDecodedBytes) {
    throw new Error("PNG decode boyutu güvenli sınırı aşıyor.");
  }

  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedDecodedBytes });
  } catch {
    throw new Error("PNG IDAT decode edilemedi.");
  }
  if (decoded.byteLength !== expectedDecodedBytes) throw new Error("PNG decode boyutu IHDR ile eşleşmiyor.");
  const pixels = unfilter(decoded, rowBytes, ihdr.height, Math.max(1, Math.ceil((channels * ihdr.bitDepth) / 8)));
  const hasVisibleContent = hasPixelVariation(pixels, ihdr, channels);
  return { width: ihdr.width, height: ihdr.height, hasVisibleContent };
}

function unfilter(decoded, rowBytes, height, bytesPerPixel) {
  const pixels = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (rowBytes + 1);
    const filter = decoded[sourceOffset];
    if (filter > 4) throw new Error("PNG satır filtresi geçersiz.");
    const targetOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = decoded[sourceOffset + column + 1];
      const left = column >= bytesPerPixel ? pixels[targetOffset + column - bytesPerPixel] : 0;
      const up = row > 0 ? pixels[targetOffset - rowBytes + column] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? pixels[targetOffset - rowBytes + column - bytesPerPixel]
        : 0;
      const predictor = filter === 1
        ? left
        : filter === 2
          ? up
          : filter === 3
            ? Math.floor((left + up) / 2)
            : filter === 4
              ? paeth(left, up, upperLeft)
              : 0;
      pixels[targetOffset + column] = (raw + predictor) & 0xff;
    }
  }
  return pixels;
}

function hasPixelVariation(pixels, ihdr, channels) {
  const pixelBytes = channels;
  let firstVisiblePixel;
  for (let offset = 0; offset < pixels.byteLength; offset += pixelBytes) {
    const alpha = ihdr.colorType === 4 || ihdr.colorType === 6 ? pixels[offset + pixelBytes - 1] : 255;
    if (alpha === 0) continue;
    const pixel = pixels.subarray(offset, offset + pixelBytes).toString("hex");
    if (firstVisiblePixel === undefined) firstVisiblePixel = pixel;
    else if (pixel !== firstVisiblePixel) return true;
  }
  return false;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function readIhdr(data) {
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8];
  const colorType = data[9];
  if (width === 0 || height === 0) throw new Error("PNG ölçüleri pozitif olmalı.");
  if (!allowedBitDepths.get(colorType)?.has(bitDepth)) throw new Error("PNG renk tipi veya bit derinliği geçersiz.");
  if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
    throw new Error("PNG compression, filter ve interlace yöntemleri desteklenmiyor.");
  }
  return { width, height, bitDepth, colorType };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

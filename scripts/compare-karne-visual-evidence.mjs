import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixtureDir = fileURLToPath(new URL("../ornek-veriler/", import.meta.url));
const expectedSize = { height: 842, width: 595 };
const options = parseArgs(process.argv.slice(2));

if (!options.ui) {
  throw new Error("UI_SCREENSHOT_REQUIRED: pass --ui <path>");
}
if (!existsSync(options.ui)) {
  throw new Error(`UI_SCREENSHOT_NOT_FOUND:${options.ui}`);
}

const targetNeedle = options.target ?? "iSEM";
const pdfName = readdirSync(fixtureDir).find((name) =>
  name.startsWith("Ahmet-ishak-") && name.includes(targetNeedle) && name.endsWith(".pdf")
);
if (!pdfName) throw new Error(`ADIGUZEL_PDF_NOT_FOUND:${targetNeedle}`);

const tempDir = mkdtempSync(join(tmpdir(), "karne-visual-diff-"));

try {
  const targetPng = join(tempDir, "target.png");
  const targetBmp = join(tempDir, "target.bmp");
  const uiBmp = join(tempDir, "ui-normalized.bmp");
  const pdfPath = join(fixtureDir, pdfName);

  runSips(["-s", "format", "png", pdfPath, "--out", targetPng], `PDF_RENDER_FAILED:${targetNeedle}`);
  runSips(["-s", "format", "bmp", targetPng, "--out", targetBmp], `TARGET_BMP_FAILED:${targetNeedle}`);
  runSips(
    ["-z", String(expectedSize.height), String(expectedSize.width), "-s", "format", "bmp", options.ui, "--out", uiBmp],
    `UI_BMP_FAILED:${options.ui}`,
  );

  const target = readBmp(targetBmp);
  const ui = readBmp(uiBmp);
  if (target.width !== expectedSize.width || target.height !== expectedSize.height) {
    throw new Error(`TARGET_SIZE_CHANGED:${target.width}x${target.height}`);
  }
  if (ui.width !== expectedSize.width || ui.height !== expectedSize.height) {
    throw new Error(`UI_NORMALIZED_SIZE_CHANGED:${ui.width}x${ui.height}`);
  }

  const diff = compareBmp(target, ui);
  const result = {
    target: targetNeedle,
    targetPdf: basename(pdfPath),
    uiScreenshot: options.ui,
    normalizedSize: `${expectedSize.width}x${expectedSize.height}`,
    changedPixels: diff.changedPixels,
    totalPixels: diff.totalPixels,
    diffRatio: Number(diff.diffRatio.toFixed(6)),
    meanChannelDelta: Number(diff.meanChannelDelta.toFixed(2)),
  };

  console.log(
    `karne-visual-diff target=${result.target} normalized=${result.normalizedSize} ` +
      `changed=${result.changedPixels}/${result.totalPixels} ratio=${result.diffRatio} ` +
      `meanChannelDelta=${result.meanChannelDelta} ui=${result.uiScreenshot}`,
  );

  if (options.maxDiffRatio !== undefined && diff.diffRatio > options.maxDiffRatio) {
    throw new Error(`KARNE_VISUAL_DIFF_TOO_HIGH:${diff.diffRatio.toFixed(6)}>${options.maxDiffRatio}`);
  }
  if (options.maxMeanChannelDelta !== undefined && diff.meanChannelDelta > options.maxMeanChannelDelta) {
    throw new Error(`KARNE_VISUAL_MEAN_DELTA_TOO_HIGH:${diff.meanChannelDelta.toFixed(2)}>${options.maxMeanChannelDelta}`);
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--ui") {
      parsed.ui = args[index + 1];
      index += 1;
    } else if (arg === "--target") {
      parsed.target = args[index + 1];
      index += 1;
    } else if (arg === "--max-diff-ratio") {
      parsed.maxDiffRatio = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--max-mean-channel-delta") {
      parsed.maxMeanChannelDelta = Number(args[index + 1]);
      index += 1;
    }
  }
  return parsed;
}

function runSips(args, errorCode) {
  const result = spawnSync("sips", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${errorCode}:${result.stderr || result.stdout}`);
  }
}

function readBmp(path) {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 2) !== "BM") {
    throw new Error(`BMP_SIGNATURE_INVALID:${path}`);
  }

  const pixelOffset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const bitsPerPixel = buffer.readUInt16LE(28);
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new Error(`BMP_UNSUPPORTED_DEPTH:${bitsPerPixel}`);
  }

  const bytesPerPixel = bitsPerPixel / 8;
  const stride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const topDown = rawHeight < 0;
  return { buffer, bytesPerPixel, height, pixelOffset, stride, topDown, width };
}

function compareBmp(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`BMP_SIZE_MISMATCH:${left.width}x${left.height}:${right.width}x${right.height}`);
  }

  let changedPixels = 0;
  let totalDelta = 0;
  const totalPixels = left.width * left.height;
  for (let y = 0; y < left.height; y += 1) {
    const leftY = left.topDown ? y : left.height - 1 - y;
    const rightY = right.topDown ? y : right.height - 1 - y;
    for (let x = 0; x < left.width; x += 1) {
      const leftOffset = left.pixelOffset + leftY * left.stride + x * left.bytesPerPixel;
      const rightOffset = right.pixelOffset + rightY * right.stride + x * right.bytesPerPixel;
      const db = Math.abs(left.buffer[leftOffset] - right.buffer[rightOffset]);
      const dg = Math.abs(left.buffer[leftOffset + 1] - right.buffer[rightOffset + 1]);
      const dr = Math.abs(left.buffer[leftOffset + 2] - right.buffer[rightOffset + 2]);
      const delta = db + dg + dr;
      totalDelta += delta;
      if (delta > 12) changedPixels += 1;
    }
  }

  return {
    changedPixels,
    diffRatio: changedPixels / totalPixels,
    meanChannelDelta: totalDelta / (totalPixels * 3),
    totalPixels,
  };
}

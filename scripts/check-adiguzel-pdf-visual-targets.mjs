import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixtureDir = new URL("../ornek-veriler/", import.meta.url);

const targets = [
  {
    label: "3D",
    fileNameNeedle: "3D",
    pngSha256: "d3a54d78fb9850b2c99e0de478d98ee025526c41677632291c302313602dfe0a",
  },
  {
    label: "MUBA",
    fileNameNeedle: "MUBA",
    pngSha256: "e7663415dec99701151b20ac9af2d6861cd1a365f00d921a563d642f89b08494",
  },
  {
    label: "iSEM",
    fileNameNeedle: "iSEM",
    pngSha256: "7fc8740c2453145358806b9310373fbacde0829bae28f8d61952dfa0e89830ac",
  },
];

const expectedSize = { height: 842, width: 595 };

if (!existsSync(fixtureDir)) {
  throw new Error("ORNEK_VERILER_NOT_FOUND");
}

const sipsCheck = spawnSync("sips", ["--help"], { encoding: "utf8" });
if (sipsCheck.error) {
  throw new Error("SIPS_NOT_AVAILABLE");
}

const fixturePath = fileURLToPath(fixtureDir);
const tempDir = mkdtempSync(join(tmpdir(), "adiguzel-pdf-targets-"));

try {
  for (const target of targets) {
    const pdfName = readdirSync(fixturePath).find((name) =>
      name.startsWith("Ahmet-ishak-") && name.includes(target.fileNameNeedle) && name.endsWith(".pdf")
    );
    if (!pdfName) throw new Error(`ADIGUZEL_PDF_NOT_FOUND:${target.fileNameNeedle}`);

    const pdfPath = join(fixturePath, pdfName);
    const pngPath = join(tempDir, `${target.label}.png`);
    const render = spawnSync("sips", ["-s", "format", "png", pdfPath, "--out", pngPath], { encoding: "utf8" });
    if (render.status !== 0) {
      throw new Error(`PDF_RENDER_FAILED:${target.label}:${render.stderr || render.stdout}`);
    }

    const metadata = readImageMetadata(pngPath);
    if (metadata.width !== expectedSize.width || metadata.height !== expectedSize.height) {
      throw new Error(`PDF_TARGET_SIZE_CHANGED:${target.label}:${metadata.width}x${metadata.height}`);
    }

    const pngSha256 = createHash("sha256").update(readFileSync(pngPath)).digest("hex");
    if (pngSha256 !== target.pngSha256) {
      throw new Error(`PDF_TARGET_HASH_CHANGED:${target.label}:${pngSha256}`);
    }

    console.log(`${target.label}: ${basename(pdfPath)} -> ${metadata.width}x${metadata.height} sha256=${pngSha256}`);
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function readImageMetadata(path) {
  const result = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`IMAGE_METADATA_FAILED:${result.stderr || result.stdout}`);
  }

  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  return { height, width };
}

/**
 * Step 6 — hash the built executable (+ preview when present) and upload
 * both to R2. Records keys + hashes for the completion callback.
 * Fails the workflow when no executable exists (nothing to release).
 */
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadRunResult, r2Put, readCreds, saveRunResult, sha256Hex } from "./r2.ts";

function findExe(dir: string): string | null {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      const nested = findExe(full);
      if (nested) return nested;
    } else if (entry.toLowerCase().endsWith(".exe")) {
      return full;
    }
  }
  return null;
}

function appPrefix(): string {
  return `${process.env.ADORABLE_APP_ID ?? "app"}/${process.env.ADORABLE_BUILD_ID ?? "build"}`;
}

import { packageStandaloneWindows } from "./package.ts";

const run = loadRunResult();
const creds = readCreds();
packageStandaloneWindows(run.wsDir);
const exe = findExe(join(run.wsDir, "dist"));
if (!exe || !existsSync(exe)) throw new Error("No executable produced by the build.");

const exeBytes = new Uint8Array(readFileSync(exe));
const exeSha = await sha256Hex(exeBytes);
const fileName = basename(exe);
const artifactKey = `${appPrefix()}/${fileName}`;
await r2Put(creds, artifactKey, exeBytes, "application/octet-stream");

// Preview is best-effort: screenshot the running app when a desktop exists.
let previewKey: string | undefined;
try {
  const previewPng = join(run.wsDir, "artifacts", "preview.png");
  if (existsSync(previewPng)) {
    const pngBytes = new Uint8Array(readFileSync(previewPng));
    if (pngBytes.length > 0) {
      previewKey = `${appPrefix()}/preview.png`;
      await r2Put(creds, previewKey, pngBytes, "image/png");
      console.log(`Uploaded preview screenshot to ${previewKey} (${pngBytes.length} bytes).`);
    } else {
      console.log("Preview screenshot exists but was empty (0 bytes).");
    }
  } else {
    console.log("No preview screenshot found at artifacts/preview.png.");
  }
} catch (err) {
  console.log(`Preview upload error (best-effort): ${(err as Error)?.message ?? err}`);
}
saveRunResult({
  artifactKey,
  artifactSha256: exeSha,
  artifactSize: exeBytes.length,
  fileName,
  ...(previewKey ? { previewKey } : {}),
});
console.log(`Uploaded ${fileName} (${exeBytes.length} bytes).`);

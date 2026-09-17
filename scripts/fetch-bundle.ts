/**
 * Step 1 — fetch the validated source bundle from R2 and verify its hash.
 * Fails the workflow on any mismatch (never build unverified sources).
 * Writes files into $RUNNER_TEMP/adorable-ws with path-traversal guards.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { readCreds, r2Get, saveRunResult, sha256Hex } from "./r2.ts";

const key = process.env.ADORABLE_SOURCE_BUNDLE_KEY ?? "";
const expectedSha = (process.env.ADORABLE_SOURCE_BUNDLE_SHA256 ?? "").toLowerCase();
if (!key) throw new Error("Source bundle key is missing.");
if (!/^[0-9a-f]{64}$/.test(expectedSha)) throw new Error("Source bundle hash is malformed.");

const creds = readCreds();
const bytes = await r2Get(creds, key);
if (!bytes) throw new Error("Source bundle not found in object storage.");
const actualSha = await sha256Hex(bytes);
if (actualSha !== expectedSha) throw new Error("Source bundle hash mismatch; refusing to build.");

const text = new TextDecoder().decode(bytes);
const bundle = JSON.parse(text) as { files?: Array<{ path?: unknown; content?: unknown }> };
if (!bundle || !Array.isArray(bundle.files) || bundle.files.length === 0) {
  throw new Error("Source bundle has no files.");
}
const wsDir = join(process.env.RUNNER_TEMP ?? "", "adorable-ws");
let count = 0;
for (const f of bundle.files) {
  if (!f || typeof f.path !== "string" || typeof f.content !== "string") throw new Error("Source bundle entry malformed.");
  const rel = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.length > 512) {
    throw new Error("Source bundle path rejected.");
  }
  if (f.content.length > 500_000) throw new Error("Source bundle entry too large.");
  const dest = resolve(wsDir, rel);
  if (dest !== wsDir && !dest.startsWith(wsDir + sep)) throw new Error("Source bundle escape rejected.");
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, f.content, "utf8");
  count++;
}
saveRunResult({ filesStaged: count, sourceVerified: true });
console.log(`Staged ${count} verified source files.`);

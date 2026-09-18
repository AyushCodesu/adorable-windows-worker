/** Final cleanup step — delete the per-run workspace and transient result file. */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadRunResult } from "./r2.ts";

const tmp = process.env.RUNNER_TEMP ?? "";
const run = loadRunResult();

for (const path of [
  run.wsDir,
  tmp ? join(tmp, "adorable-result.json") : "",
]) {
  if (!path) continue;
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort; the runner itself is ephemeral.
  }
}

console.log("Cleanup complete.");

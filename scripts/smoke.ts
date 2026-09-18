/**
 * Step 5 — best-effort native smoke on headless runners.
 *
 * Launches the built executable briefly to prove it starts, then always
 * terminates the tree. NEVER fails the build: headless CI sessions may
 * lack a visible desktop, so the outcome is recorded honestly
 * (launchOk true/false) for the backend to surface.
 */
import { existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadRunResult, saveRunResult } from "./r2.ts";

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

import { packageStandaloneWindows } from "./package.ts";

const wsDir = loadRunResult().wsDir;
packageStandaloneWindows(wsDir);
const exe = findExe(join(wsDir, "dist"));
if (!exe || !existsSync(exe)) {
  saveRunResult({ launchOk: false, launchNote: "no-executable" });
  console.log("Smoke skipped: no executable found.");
  process.exit(0);
}

let child: ReturnType<typeof Bun.spawn> | null = null;
let previewOk = false;
try {
  child = Bun.spawn([exe], { cwd: join(exe, ".."), stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  // Best-effort screenshot (pinned copy of the backend capture helper).
  // Headless runners may yield no window; that is recorded, not fatal.
  try {
    const pid = (child as unknown as { pid: number }).pid;
    const script = join(import.meta.dir, "capture-window.ps1");
    const outPng = join(wsDir, "artifacts", "preview.png");
    mkdirSync(join(wsDir, "artifacts"), { recursive: true });
    const cap = Bun.spawnSync(
      ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ProcessId", String(pid), "-OutputPath", outPng, "-TimeoutMs", "12000"],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
    const text = new TextDecoder().decode(cap.stdout).trim();
    if (text.startsWith("SUCCESS:") && existsSync(outPng)) previewOk = true;
  } catch {
    /* preview best-effort */
  }
  await new Promise((r) => setTimeout(r, 8000));
  const exitCode = (child as unknown as { exitCode: number | null }).exitCode;
  if (exitCode !== null && exitCode !== 0) {
    saveRunResult({ launchOk: false, previewOk, launchNote: `immediate-exit-${exitCode}` });
    console.log(`Smoke: immediate exit ${exitCode}.`);
  } else {
    saveRunResult({ launchOk: true, previewOk });
    console.log(`Smoke: process alive after settle window (preview ${previewOk ? "captured" : "unavailable"}).`);
  }
} catch (err) {
  saveRunResult({ launchOk: false, launchNote: String((err as Error)?.message ?? err).slice(0, 120) });
  console.log("Smoke: launch threw; recorded honestly.");
} finally {
  if (child) {
    const pid = (child as unknown as { pid: number }).pid;
    try {
      Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    } catch {
      /* ignore */
    }
    try {
      (child as unknown as { kill: () => void }).kill();
    } catch {
      /* ignore */
    }
  }
}

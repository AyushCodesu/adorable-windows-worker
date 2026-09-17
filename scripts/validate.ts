/**
 * Step 4 — trusted security validation over the staged workspace.
 *
 * These checks run from THIS repository (trusted worker code), never from
 * the untrusted app bundle: dependency policy + secret/path scan + unsafe
 * link detection. Findings fail the workflow; the backend records them.
 */
import { readdirSync, readFileSync, statSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { loadRunResult, saveRunResult } from "./r2.ts";

const wsDir = loadRunResult().wsDir;
const findings: string[] = [];

function walk(dir: string, out: string[]): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      findings.push(`link:${relative(wsDir, full)}`);
      continue;
    }
    try {
      if (st.isDirectory()) walk(full, out);
      else out.push(full);
    } catch {
      /* ignore */
    }
  }
}

const files: string[] = [];
walk(wsDir, files);
const read = (p: string): string => {
  try {
    const content = readFileSync(p, "utf8");
    return content.length > 500_000 ? "" : content;
  } catch {
    return "";
  }
};

// 1. Dependency policy: framework packages only, no lifecycle scripts.
try {
  const pkg = JSON.parse(read(join(wsDir, "package.json"))) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const allowed = new Set(["@quickgui/native", "@quickgui/solid", "@quickgui/cli", "solid-js", "typescript", "@types/bun"]);
  for (const section of [pkg.dependencies ?? {}, pkg.devDependencies ?? {}]) {
    for (const name of Object.keys(section)) {
      if (!allowed.has(name)) findings.push(`dependency:${name}`);
    }
  }
  for (const name of Object.keys(pkg.scripts ?? {})) {
    if (["preinstall", "install", "postinstall", "prepare", "prepublishOnly"].includes(name)) {
      findings.push(`lifecycle-script:${name}`);
    }
  }
} catch {
  findings.push("manifest-unreadable");
}

// 2. Secret / path scan over app sources.
const SECRET_RES = [
  /OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY/,
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
  /sk-or-v1-[A-Za-z0-9]{8,}/,
  /ghp_[A-Za-z0-9]{8,}/,
  /\.env(\.|$)/,
];
const PATH_RES = [/[A-Za-z]:\\Users\\/i, /adorable[\\/]workspaces/i, /\.\.[\/\\]\.\./];
for (const full of files) {
  if (!(full.endsWith(".tsx") || full.endsWith(".ts") || full.endsWith(".js"))) continue;
  if (full.includes(`${"runtime"}${"/"}adorable-store.ts`)) continue;
  const content = read(full);
  if (!content) continue;
  for (const re of SECRET_RES) {
    if (re.test(content)) {
      findings.push("secret-pattern");
      break;
    }
  }
  for (const re of PATH_RES) {
    if (re.test(content)) {
      findings.push("unsafe-path");
      break;
    }
  }
  if (/child_process|powershell|cmd\.exe|\bBun\s*\.\s*spawn/.test(content)) findings.push("spawn-pattern");
}

const passed = findings.length === 0;
saveRunResult({ securityPassed: passed, securityFindings: findings.slice(0, 20) });
if (!passed) {
  console.log(`Security validation failed: ${findings.slice(0, 5).join(", ")}`);
  process.exit(1);
}
console.log("Security validation passed.");

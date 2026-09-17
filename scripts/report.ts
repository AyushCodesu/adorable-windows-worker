/**
 * Final step — report completion to the backend callback (always runs).
 *
 * Retries waking free-tier hosts: 3 attempts ~60s apart, then gives up
 * (the backend's lazy staleness reaper marks the job interrupted on read,
 * and startup recovery covers restarts — the job is never silently lost,
 * just late). Never throws credentials into logs; the callback secret
 * travels in the Authorization header only.
 */
import { loadRunResult } from "./r2.ts";

const callbackUrl = process.env.ADORABLE_CALLBACK_URL ?? "";
const secret = process.env.ADORABLE_CALLBACK_SECRET ?? "";
if (!callbackUrl) throw new Error("Callback URL is missing.");
if (!secret) throw new Error("Callback secret is missing.");

const run = loadRunResult();
const failed = (process.env.ADORABLE_STEP_FAILED ?? "") === "1";

// Normalize to the backend's snake_case callback contract explicitly.
const payload: Record<string, unknown> = {
  job_id: process.env.ADORABLE_JOB_ID ?? run.jobId,
  status: failed ? "failed" : "succeeded",
  app_id: process.env.ADORABLE_APP_ID ?? run.appId,
  build_id: process.env.ADORABLE_BUILD_ID ?? run.buildId,
  ...(typeof run.artifactKey === "string" ? { artifact_key: run.artifactKey } : {}),
  ...(typeof run.artifactSha256 === "string" ? { artifact_sha256: run.artifactSha256 } : {}),
  ...(typeof run.artifactSize === "number" ? { artifact_size: run.artifactSize } : {}),
  ...(typeof run.fileName === "string" ? { file_name: run.fileName } : {}),
  ...(typeof run.previewKey === "string" ? { preview_key: run.previewKey } : {}),
  ...(typeof run.sourceRevision === "string" ? { source_revision: run.sourceRevision } : {}),
  release_status: ["BUILD_SUCCEEDED"],
  events: [{ kind: "remote-complete", payload: { launchOk: (run as Record<string, unknown>).launchOk ?? null } }],
};
if (failed) {
  payload.error_code = "REMOTE_BUILD_FAILED";
  payload.error_message = "The remote Windows build did not complete successfully.";
}

let delivered = false;
let lastError = "";
for (let attempt = 1; attempt <= 3 && !delivered; attempt++) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (res.ok) {
        delivered = true;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    lastError = String((err as Error)?.message ?? err).slice(0, 120);
  }
  if (!delivered && attempt < 3) await new Promise((r) => setTimeout(r, 60000));
}
if (!delivered) {
  console.log(`Callback not delivered after 3 attempts (${lastError}); backend reaper will mark the job.`);
  process.exit(1);
}
console.log("Completion reported.");

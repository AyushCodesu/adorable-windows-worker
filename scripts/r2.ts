/**
 * Adorable Windows build worker — shared R2 SigV4 client.
 *
 * Pinned, reviewed copy of the signing logic whose source of truth lives
 * in the backend repository (builder/src/cloud/signer.ts). When updating,
 * change the backend first, then copy here and record the backend commit
 * in README.md. Secrets are function arguments only — never logged.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, bytes as BufferSource));
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { sha256Hex };

function encodeSigV4(value: string, encodeSlash: boolean): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/gi, encodeSlash ? "%2F" : "/");
}

export interface R2Creds {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function readCreds(): R2Creds {
  // GitHub secret textareas can preserve a trailing newline when a value is pasted.
  // Trim the values at the boundary so whitespace cannot corrupt SigV4 headers or URLs.
  const creds = {
    accountId: (process.env.R2_ACCOUNT_ID ?? "").trim(),
    accessKeyId: (process.env.R2_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY ?? "").trim(),
    bucket: (process.env.R2_BUCKET ?? "").trim(),
  };
  if (!creds.accountId || !creds.accessKeyId || !creds.secretAccessKey || !creds.bucket) {
    throw new Error("R2 credentials/bucket are not configured in this runner.");
  }
  return creds;
}

export function objectUrl(creds: R2Creds, key: string): string {
  const safe = key.split("/").map(encodeURIComponent).join("/");
  return `https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}/${safe}`;
}

async function signedFetch(
  creds: R2Creds,
  method: "GET" | "PUT",
  url: string,
  body?: Uint8Array,
  contentType?: string,
): Promise<Response> {
  const parsed = new URL(url);
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\\.\\d+/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body ?? new Uint8Array(0));
  const headers: Record<string, string> = {
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\\n`).join("");
  const canonical =
    [method, parsed.pathname.split("/").map((s) => encodeSigV4(s, true)).join("/") || "/", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonical)].join("\n");
  const kDate = await hmac(encoder.encode(`AWS4${creds.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, "auto");
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = [...(await hmac(kSigning, toSign))].map((b) => b.toString(16).padStart(2, "0")).join("");
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(url, { method, headers, body: body as BodyInit | undefined });
}

export async function r2Get(creds: R2Creds, key: string): Promise<Uint8Array | null> {
  const res = await signedFetch(creds, "GET", objectUrl(creds, key));
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`R2 download failed (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function r2Put(creds: R2Creds, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const res = await signedFetch(creds, "PUT", objectUrl(creds, key), bytes, contentType);
  if (!res.ok) throw new Error(`R2 upload failed (HTTP ${res.status}).`);
}

export interface RunResult {
  appId: string;
  buildId: string;
  jobId: string;
  wsDir: string;
  [k: string]: unknown;
}

export function loadRunResult(): RunResult {
  const tmp = process.env.RUNNER_TEMP ?? "";
  const path = join(tmp, "adorable-result.json");
  const base: RunResult = {
    appId: process.env.ADORABLE_APP_ID ?? "",
    buildId: process.env.ADORABLE_BUILD_ID ?? "",
    jobId: process.env.ADORABLE_JOB_ID ?? "",
    wsDir: join(tmp, "adorable-ws"),
  };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") return { ...base, ...parsed } as RunResult;
  } catch {
    /* fall through */
  }
  return base;
}

export function saveRunResult(patch: Record<string, unknown>): void {
  const tmp = process.env.RUNNER_TEMP ?? "";
  const path = join(tmp, "adorable-result.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...loadRunResult(), ...patch }));
}

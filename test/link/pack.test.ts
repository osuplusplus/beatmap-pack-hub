import { describe, expect, it } from "vitest";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

const workerUrl = process.env.CF_WORKER_URL?.trim().replace(/\/$/, "");
const runLinkTests = Boolean(workerUrl);
const hasProxy = Boolean(process.env.HTTP_PROXY || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.https_proxy);
const dispatcher = hasProxy ? new EnvHttpProxyAgent() : undefined;

function workerEndpoint(path: string): URL {
  try {
    return new URL(path, `${workerUrl}/`);
  } catch {
    throw new Error("CF_WORKER_URL must be an absolute URL, for example https://beatmap-pack-hub.example.workers.dev");
  }
}

async function requestWorker(path: string) {
  return undiciFetch(workerEndpoint(path), { dispatcher, signal: AbortSignal.timeout(15_000) });
}

describe.runIf(runLinkTests)("Cloudflare Worker connection", () => {
  it("responds to the health check", async () => {
    const response = await requestWorker("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("can query the D1-backed pack endpoint", async () => {
    // This valid but extremely unlikely share ID keeps the probe read-only. A 404
    // proves that the Worker reached its D1 binding and executed the query.
    const response = await requestWorker("/api/v1/packs/ZZZZZZ");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PACK_NOT_FOUND", message: "Pack not found" },
    });
  });
});

describe.skipIf(runLinkTests)("Cloudflare Worker connection", () => {
  it("requires CF_WORKER_URL to run", () => {
    // Kept as a skipped suite so normal unit tests never depend on a deployed Worker.
  });
});

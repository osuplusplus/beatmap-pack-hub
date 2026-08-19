import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { Env } from "../../src/types";
import { MemoryPackRepository } from "../support/memory-pack-repository";

const env = { ALLOW_DEV_AUTH: "true" } as Env;

describe("pack API", () => {
  let repository: MemoryPackRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    repository = new MemoryPackRepository();
    app = createApp(() => repository);
  });

  async function createPack(ids = [123456, 234567, 123456]) {
    const response = await app.request("/api/v1/packs", {
      method: "POST",
      headers: { "content-type": "application/json", "X-BPH-User-ID": "dev-user" },
      body: JSON.stringify({ title: "Tech Training", description: "My tech collection", beatmapset_ids: ids }),
    }, env);
    expect(response.status).toBe(201);
    return (await response.json() as { id: string }).id;
  }

  it("creates and retrieves a pack while preserving deduplicated order", async () => {
    const id = await createPack();
    const response = await app.request(`/api/v1/packs/BPH-${id}`, {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id,
      title: "Tech Training",
      owner: { id: "dev-user", display_name: "Local Developer" },
      beatmapset_ids: [123456, 234567],
      rating: { average: null, count: 0 },
    });
  });

  it("lists public recommendations and hides private packs", async () => {
    await createPack();
    const privateResponse = await app.request("/api/v1/packs", {
      method: "POST",
      headers: { "content-type": "application/json", "X-BPH-User-ID": "dev-user" },
      body: JSON.stringify({ title: "Private", beatmapset_ids: [99], is_private: true }),
    }, env);
    const privateId = (await privateResponse.json() as { id: string }).id;

    const recommendations = await app.request("/api/v1/packs/recommendations?limit=50", {}, env);
    expect(recommendations.status).toBe(200);
    expect((await recommendations.json() as { packs: Array<{ id: string; is_private: boolean }> }).packs)
      .toEqual([expect.objectContaining({ is_private: false })]);

    const hidden = await app.request(`/api/v1/packs/${privateId}`, {}, env);
    expect(hidden.status).toBe(404);
    const ownerView = await app.request(`/api/v1/packs/${privateId}`, {
      headers: { "X-BPH-User-ID": "dev-user" },
    }, env);
    expect(ownerView.status).toBe(200);
    expect(await ownerView.json()).toMatchObject({ is_private: true, likes: { count: 0 }, comments: { count: 0 } });
  });

  it("updates content only for the owner", async () => {
    const id = await createPack();
    const forbidden = await app.request(`/api/v1/packs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "X-BPH-User-ID": "other-user" },
      body: JSON.stringify({ title: "Hijacked" }),
    }, env);
    expect(forbidden.status).toBe(403);

    const updated = await app.request(`/api/v1/packs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "X-BPH-User-ID": "dev-user" },
      body: JSON.stringify({ title: "Updated", beatmapset_ids: [9, 8, 9] }),
    }, env);
    expect(updated.status).toBe(204);
    const response = await app.request(`/api/v1/packs/${id}`, {}, env);
    expect(await response.json()).toMatchObject({ title: "Updated", beatmapset_ids: [9, 8] });
  });

  it("upserts ratings and supports idempotent favorites", async () => {
    const id = await createPack();
    for (const score of [3, 5]) {
      expect((await app.request(`/api/v1/packs/${id}/rating`, {
        method: "PUT",
        headers: { "content-type": "application/json", "X-BPH-User-ID": "dev-user" },
        body: JSON.stringify({ score }),
      }, env)).status).toBe(204);
    }
    const pack = await (await app.request(`/api/v1/packs/${id}`, {}, env)).json() as { rating: unknown };
    expect(pack.rating).toEqual({ average: 5, count: 1 });

    const favoriteUrl = `/api/v1/packs/${id}/favorite`;
    const headers = { "X-BPH-User-ID": "dev-user" };
    expect((await app.request(favoriteUrl, { method: "PUT", headers }, env)).status).toBe(204);
    expect((await app.request(favoriteUrl, { method: "PUT", headers }, env)).status).toBe(204);
    expect(repository.favorites.size).toBe(1);

    const viewerResponse = await app.request(`/api/v1/packs/${id}`, {
      headers: { "X-BPH-User-ID": "dev-user" },
    }, env);
    expect(await viewerResponse.json()).toMatchObject({
      viewer: { rating: 5, favorited: true, can_edit: true },
    });
    expect(viewerResponse.headers.get("cache-control")).toBe("no-store");

    expect((await app.request(favoriteUrl, { method: "DELETE", headers }, env)).status).toBe(204);
    expect(repository.favorites.size).toBe(0);
  });

  it("exposes an OPP integration contract and supports CORS preflight", async () => {
    const contract = await app.request("/api/v1", {}, env);
    expect(contract.status).toBe(200);
    expect(await contract.json()).toMatchObject({
      api_version: 1,
      auth: { mode: "ed25519-challenge", development_header_enabled: true },
      features: expect.arrayContaining(["packs", "viewer_state", "challenge_auth"]),
    });
    expect(contract.headers.get("x-request-id")).toBeTruthy();

    const preflight = await app.request("/api/v1/packs", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-bph-user-id",
      },
    }, env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("X-BPH-User-ID");
    expect(preflight.headers.get("x-request-id")).toBeTruthy();
  });

  it("rejects JSON endpoints with an unsupported media type", async () => {
    const response = await app.request("/api/v1/packs", {
      method: "POST",
      headers: { "content-type": "text/plain", "X-BPH-User-ID": "dev-user" },
      body: JSON.stringify({ title: "Pack", beatmapset_ids: [1] }),
    }, env);
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
  });

  it("returns unified errors for invalid input and missing packs", async () => {
    const invalid = await app.request("/api/v1/packs", {
      method: "POST",
      headers: { "content-type": "application/json", "X-BPH-User-ID": "dev-user" },
      body: JSON.stringify({ title: "", beatmapset_ids: [0] }),
    }, env);
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const missing = await app.request("/api/v1/packs/ABC234", {}, env);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "PACK_NOT_FOUND", message: "Pack not found" } });
  });

  it("requires an identity for mutations and hides internal failures", async () => {
    const unauthorized = await app.request("/api/v1/packs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Pack", beatmapset_ids: [1] }),
    }, env);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });

    const brokenRepository = new MemoryPackRepository();
    brokenRepository.userExists = async () => { throw new Error("secret database detail"); };
    const brokenApp = createApp(() => brokenRepository);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = await brokenApp.request("/api/v1/packs", {
      method: "POST",
      headers: { "content-type": "application/json", "X-BPH-User-ID": "dev-user" },
      body: JSON.stringify({ title: "Pack", beatmapset_ids: [1] }),
    }, env);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "An internal error occurred" } });
    consoleError.mockRestore();
  });

  it("deletes a pack and then returns 404", async () => {
    const id = await createPack();
    expect((await app.request(`/api/v1/packs/${id}`, {
      method: "DELETE",
      headers: { "X-BPH-User-ID": "dev-user" },
    }, env)).status).toBe(204);
    expect((await app.request(`/api/v1/packs/${id}`, {}, env)).status).toBe(404);
  });
});

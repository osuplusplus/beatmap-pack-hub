import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { decodeBase64Url, encodeBase64Url } from "../../src/domain/encoding";
import { AuthService } from "../../src/services/auth-service";
import type { Env } from "../../src/types";
import { MemoryAuthRepository } from "../support/memory-auth-repository";
import { MemoryPackRepository } from "../support/memory-pack-repository";

const env = { ALLOW_DEV_AUTH: "true", ENVIRONMENT: "test" } as Env;

interface TestKeyPair {
  pair: CryptoKeyPair;
  publicKey: string;
}

interface SessionResponse {
  access_token: string;
  user: { id: string; display_name: string };
  device: { id: string; device_name: string };
}

describe("profile and multi-device authentication API", () => {
  let authRepository: MemoryAuthRepository;
  let packRepository: MemoryPackRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    authRepository = new MemoryAuthRepository();
    packRepository = new MemoryPackRepository();
    app = createApp(() => packRepository, () => authRepository);
  });

  async function keyPair(): Promise<TestKeyPair> {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicKey = encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    return { pair, publicKey };
  }

  async function sign(keys: TestKeyPair, message: string): Promise<string> {
    return encodeBase64Url(new Uint8Array(await crypto.subtle.sign(
      { name: "Ed25519" },
      keys.pair.privateKey,
      Uint8Array.from(decodeBase64Url(message)).buffer,
    )));
  }

  async function handshake(
    keys: TestKeyPair,
    displayName = "OPP Player",
    deviceName = "Main PC",
  ): Promise<SessionResponse> {
    const message = AuthService.handshakeMessage(keys.publicKey, displayName, deviceName);
    const response = await app.request("/api/v1/auth/handshake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        public_key: keys.publicKey,
        display_name: displayName,
        device_name: deviceName,
        signature: await sign(keys, message),
      }),
    }, env);
    expect(response.status).toBe(201);
    return await response.json() as SessionResponse;
  }

  it("creates a profile on first handshake and supports later challenge login", async () => {
    const keys = await keyPair();
    const initialSession = await handshake(keys);
    packRepository.users.set(initialSession.user.id, initialSession.user.display_name);
    expect(initialSession.device.device_name).toBe("Main PC");

    const challengeResponse = await app.request("/api/v1/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ public_key: keys.publicKey }),
    }, env);
    const challenge = await challengeResponse.json() as { challenge_id: string; message: string };
    const signature = await sign(keys, challenge.message);
    const verificationBody = JSON.stringify({ challenge_id: challenge.challenge_id, signature });
    const verification = await app.request("/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: verificationBody,
    }, env);
    expect(verification.status).toBe(200);
    const session = await verification.json() as SessionResponse;
    expect(session.user.id).toBe(initialSession.user.id);
    expect(session.device.id).toBe(initialSession.device.id);

    const authorization = `Bearer ${session.access_token}`;
    expect((await app.request("/api/v1/packs", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ title: "Authenticated Pack", beatmapset_ids: [42] }),
    }, env)).status).toBe(201);

    const replay = await app.request("/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: verificationBody,
    }, env);
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: { code: "INVALID_CHALLENGE" } });
  });

  it("links a second device to the same profile and revokes only that device", async () => {
    const firstKeys = await keyPair();
    const first = await handshake(firstKeys);
    packRepository.users.set(first.user.id, first.user.display_name);
    const firstAuthorization = { authorization: `Bearer ${first.access_token}` };

    const linkResponse = await app.request("/api/v1/auth/device-links", {
      method: "POST",
      headers: firstAuthorization,
    }, env);
    expect(linkResponse.status).toBe(201);
    const link = await linkResponse.json() as { link_token: string };

    const secondKeys = await keyPair();
    const secondDeviceName = "Laptop";
    const linkMessage = AuthService.deviceLinkMessage(link.link_token, secondKeys.publicKey, secondDeviceName);
    const secondResponse = await app.request("/api/v1/auth/devices/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        link_token: link.link_token,
        public_key: secondKeys.publicKey,
        device_name: secondDeviceName,
        signature: await sign(secondKeys, linkMessage),
      }),
    }, env);
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json() as SessionResponse;
    expect(second.user.id).toBe(first.user.id);
    expect(second.device.id).not.toBe(first.device.id);

    const secondAuthorization = { authorization: `Bearer ${second.access_token}` };
    const profile = await (await app.request("/api/v1/auth/me", {
      headers: secondAuthorization,
    }, env)).json() as { current_device_id: string; devices: unknown[] };
    expect(profile.current_device_id).toBe(second.device.id);
    expect(profile.devices).toHaveLength(2);

    const created = await app.request("/api/v1/packs", {
      method: "POST",
      headers: { ...secondAuthorization, "content-type": "application/json" },
      body: JSON.stringify({ title: "Shared Profile Pack", beatmapset_ids: [7] }),
    }, env);
    expect(created.status).toBe(201);

    const revoked = await app.request(`/api/v1/auth/devices/${second.device.id}`, {
      method: "DELETE",
      headers: firstAuthorization,
    }, env);
    expect(revoked.status).toBe(204);
    const rejected = await app.request("/api/v1/auth/me", { headers: secondAuthorization }, env);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({ error: { code: "INVALID_SESSION" } });

    const firstStillWorks = await app.request("/api/v1/auth/me", { headers: firstAuthorization }, env);
    expect(firstStillWorks.status).toBe(200);
    const selfRevoke = await app.request(`/api/v1/auth/devices/${first.device.id}`, {
      method: "DELETE",
      headers: firstAuthorization,
    }, env);
    expect(selfRevoke.status).toBe(409);
  });

  it("rejects a handshake signed by a different private key", async () => {
    const owner = await keyPair();
    const attacker = await keyPair();
    const message = AuthService.handshakeMessage(owner.publicKey, "Protected", "Main PC");
    const response = await app.request("/api/v1/auth/handshake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        public_key: owner.publicKey,
        display_name: "Protected",
        device_name: "Main PC",
        signature: await sign(attacker, message),
      }),
    }, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_SIGNATURE" } });
  });

  it("rejects the development identity header when compatibility mode is disabled", async () => {
    const response = await app.request("/api/v1/packs", {
      method: "POST",
      headers: { "content-type": "application/json", "X-BPH-User-ID": "dev-user" },
      body: JSON.stringify({ title: "Rejected", beatmapset_ids: [1] }),
    }, { ALLOW_DEV_AUTH: "false" } as Env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "DEV_AUTH_DISABLED" } });
  });
});

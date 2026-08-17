import { AUTH } from "../config";
import { decodeBase64Url, encodeBase64Url, randomToken, sha256 } from "../domain/encoding";
import { AppError } from "../errors";
import type {
  AuthDevice,
  AuthPrincipal,
  AuthRepository,
  AuthUser,
} from "../repositories/auth-repository";

const encoder = new TextEncoder();

async function importPublicKey(encoded: string): Promise<CryptoKey> {
  try {
    const raw = decodeBase64Url(encoded);
    if (raw.byteLength !== 32) throw new Error("invalid Ed25519 key length");
    return await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(raw).buffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw new AppError(400, "INVALID_PUBLIC_KEY", "public_key must be a base64url-encoded Ed25519 public key");
  }
}

async function verifySignature(publicKey: string, message: string, signature: string): Promise<void> {
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBase64Url(signature);
  } catch {
    throw new AppError(401, "INVALID_SIGNATURE", "Signature verification failed");
  }
  if (signatureBytes.byteLength !== 64) {
    throw new AppError(401, "INVALID_SIGNATURE", "Signature verification failed");
  }
  const key = await importPublicKey(publicKey);
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    Uint8Array.from(signatureBytes).buffer,
    Uint8Array.from(decodeBase64Url(message)).buffer,
  );
  if (!valid) throw new AppError(401, "INVALID_SIGNATURE", "Signature verification failed");
}

function publicPrincipal(principal: AuthPrincipal) {
  return {
    user: { id: principal.user.id, display_name: principal.user.displayName },
    device: { id: principal.device.id, device_name: principal.device.deviceName },
  };
}

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  static handshakeMessage(publicKey: string, displayName: string, deviceName: string): string {
    return encodeBase64Url(encoder.encode([
      AUTH.handshakeDomainSeparation,
      publicKey,
      displayName,
      deviceName,
    ].join("\n")));
  }

  static deviceLinkMessage(linkToken: string, publicKey: string, deviceName: string): string {
    return encodeBase64Url(encoder.encode([
      AUTH.deviceLinkDomainSeparation,
      linkToken,
      publicKey,
      deviceName,
    ].join("\n")));
  }

  private async issueSession(principal: AuthPrincipal) {
    const now = new Date();
    const token = randomToken();
    const expiresAt = new Date(now.getTime() + AUTH.sessionTtlMs).toISOString();
    await this.repository.createSession(await sha256(token), principal, expiresAt, now.toISOString());
    return {
      access_token: token,
      token_type: "Bearer" as const,
      expires_at: expiresAt,
      ...publicPrincipal(principal),
    };
  }

  async handshake(
    publicKey: string,
    displayName: string,
    deviceName: string,
    signature: string,
  ) {
    await verifySignature(
      publicKey,
      AuthService.handshakeMessage(publicKey, displayName, deviceName),
      signature,
    );
    if (await this.repository.findDeviceByPublicKey(publicKey)) {
      throw new AppError(409, "DEVICE_REGISTERED", "This device is already registered; use challenge login");
    }

    const now = new Date().toISOString();
    const user: AuthUser = { id: crypto.randomUUID(), displayName };
    const device: AuthDevice = {
      id: crypto.randomUUID(),
      userId: user.id,
      publicKey,
      deviceName,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    };
    await this.repository.createProfileWithDevice(user, device, now);
    return this.issueSession({ user, device });
  }

  async challenge(publicKey: string): Promise<{
    challenge_id: string;
    algorithm: "Ed25519";
    message: string;
    expires_at: string;
  }> {
    const principal = await this.repository.findDeviceByPublicKey(publicKey);
    if (!principal || principal.device.revokedAt) {
      throw new AppError(401, "AUTH_FAILED", "Authentication failed");
    }

    const now = new Date();
    const id = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + AUTH.challengeTtlMs).toISOString();
    const message = encodeBase64Url(encoder.encode([
      AUTH.domainSeparation,
      id,
      randomToken(),
      expiresAt,
    ].join("\n")));
    await this.repository.createChallenge(id, principal, message, expiresAt, now.toISOString());
    return { challenge_id: id, algorithm: "Ed25519", message, expires_at: expiresAt };
  }

  async verify(challengeId: string, signature: string) {
    const challenge = await this.repository.findChallenge(challengeId);
    const now = new Date();
    if (
      !challenge
      || challenge.usedAt
      || challenge.expiresAt <= now.toISOString()
      || challenge.principal.device.revokedAt
    ) {
      throw new AppError(401, "INVALID_CHALLENGE", "Challenge is invalid, expired, or already used");
    }

    await verifySignature(challenge.principal.device.publicKey, challenge.message, signature);
    if (!(await this.repository.consumeChallenge(challenge.id, now.toISOString()))) {
      throw new AppError(401, "INVALID_CHALLENGE", "Challenge is invalid, expired, or already used");
    }
    return this.issueSession(challenge.principal);
  }

  async authenticate(token: string): Promise<AuthPrincipal> {
    const session = await this.repository.findSession(await sha256(token));
    if (
      !session
      || session.revokedAt
      || session.expiresAt <= new Date().toISOString()
      || session.principal.device.revokedAt
    ) {
      throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
    }
    return session.principal;
  }

  async logout(token: string): Promise<void> {
    await this.repository.revokeSession(await sha256(token), new Date().toISOString());
  }

  async createDeviceLink(principal: AuthPrincipal) {
    const now = new Date();
    const linkToken = randomToken();
    const expiresAt = new Date(now.getTime() + AUTH.deviceLinkTtlMs).toISOString();
    await this.repository.createDeviceLink(
      await sha256(linkToken),
      principal,
      expiresAt,
      now.toISOString(),
    );
    return { link_token: linkToken, expires_at: expiresAt };
  }

  async linkDevice(linkToken: string, publicKey: string, deviceName: string, signature: string) {
    await verifySignature(
      publicKey,
      AuthService.deviceLinkMessage(linkToken, publicKey, deviceName),
      signature,
    );
    if (await this.repository.findDeviceByPublicKey(publicKey)) {
      throw new AppError(409, "DEVICE_REGISTERED", "This device is already registered");
    }

    const tokenHash = await sha256(linkToken);
    const link = await this.repository.findDeviceLink(tokenHash);
    const now = new Date().toISOString();
    if (!link || link.usedAt || link.expiresAt <= now) {
      throw new AppError(401, "INVALID_DEVICE_LINK", "Device link is invalid, expired, or already used");
    }
    const device: AuthDevice = {
      id: crypto.randomUUID(),
      userId: link.userId,
      publicKey,
      deviceName,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    };
    if (!(await this.repository.consumeDeviceLinkAndCreateDevice(tokenHash, device, now))) {
      throw new AppError(401, "INVALID_DEVICE_LINK", "Device link is invalid, expired, or already used");
    }
    const principal = await this.repository.findDeviceByPublicKey(publicKey);
    if (!principal) throw new Error("Linked device could not be loaded");
    return this.issueSession(principal);
  }

  async profile(principal: AuthPrincipal) {
    const devices = await this.repository.listDevices(principal.user.id);
    return {
      user: { id: principal.user.id, display_name: principal.user.displayName },
      current_device_id: principal.device.id,
      devices: devices.map((device) => ({
        id: device.id,
        device_name: device.deviceName,
        public_key: device.publicKey,
        created_at: device.createdAt,
        last_seen_at: device.lastSeenAt,
        revoked_at: device.revokedAt,
      })),
    };
  }

  async revokeDevice(principal: AuthPrincipal, deviceId: string): Promise<void> {
    if (deviceId === principal.device.id) {
      throw new AppError(409, "CANNOT_REVOKE_CURRENT_DEVICE", "The current device cannot revoke itself");
    }
    if (!(await this.repository.revokeDevice(principal.user.id, deviceId, new Date().toISOString()))) {
      throw new AppError(404, "DEVICE_NOT_FOUND", "Device not found");
    }
  }
}

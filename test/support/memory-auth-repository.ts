import type {
  AuthChallenge,
  AuthDevice,
  AuthPrincipal,
  AuthRepository,
  AuthSession,
  AuthUser,
  DeviceLink,
} from "../../src/repositories/auth-repository";

interface StoredSession {
  principal: AuthPrincipal;
  expiresAt: string;
  revokedAt: string | null;
}

interface StoredLink extends DeviceLink {
  tokenHash: string;
}

function copyPrincipal(principal: AuthPrincipal): AuthPrincipal {
  return { user: { ...principal.user }, device: { ...principal.device } };
}

export class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUser>();
  readonly devices = new Map<string, AuthDevice>();
  readonly challenges = new Map<string, AuthChallenge>();
  readonly sessions = new Map<string, StoredSession>();
  readonly links = new Map<string, StoredLink>();

  async findDeviceByPublicKey(publicKey: string): Promise<AuthPrincipal | null> {
    const device = [...this.devices.values()].find((item) => item.publicKey === publicKey);
    if (!device) return null;
    return copyPrincipal({ user: this.users.get(device.userId)!, device });
  }

  async createProfileWithDevice(user: AuthUser, device: AuthDevice): Promise<void> {
    if (await this.findDeviceByPublicKey(device.publicKey)) throw new Error("duplicate device");
    this.users.set(user.id, { ...user });
    this.devices.set(device.id, { ...device });
  }

  async createChallenge(
    id: string,
    principal: AuthPrincipal,
    message: string,
    expiresAt: string,
  ): Promise<void> {
    this.challenges.set(id, {
      id,
      principal: copyPrincipal(principal),
      message,
      expiresAt,
      usedAt: null,
    });
  }

  async findChallenge(id: string): Promise<AuthChallenge | null> {
    const challenge = this.challenges.get(id);
    if (!challenge) return null;
    const currentDevice = this.devices.get(challenge.principal.device.id)!;
    return { ...challenge, principal: copyPrincipal({ user: challenge.principal.user, device: currentDevice }) };
  }

  async consumeChallenge(id: string, usedAt: string): Promise<boolean> {
    const challenge = this.challenges.get(id);
    if (!challenge || challenge.usedAt || challenge.expiresAt <= usedAt) return false;
    challenge.usedAt = usedAt;
    return true;
  }

  async createSession(tokenHash: string, principal: AuthPrincipal, expiresAt: string): Promise<void> {
    this.sessions.set(tokenHash, { principal: copyPrincipal(principal), expiresAt, revokedAt: null });
  }

  async findSession(tokenHash: string): Promise<AuthSession | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    const device = this.devices.get(session.principal.device.id)!;
    return {
      principal: copyPrincipal({ user: session.principal.user, device }),
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    };
  }

  async revokeSession(tokenHash: string, revokedAt: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session && !session.revokedAt) session.revokedAt = revokedAt;
  }

  async createDeviceLink(tokenHash: string, principal: AuthPrincipal, expiresAt: string): Promise<void> {
    this.links.set(tokenHash, { tokenHash, userId: principal.user.id, expiresAt, usedAt: null });
  }

  async findDeviceLink(tokenHash: string): Promise<DeviceLink | null> {
    const link = this.links.get(tokenHash);
    return link ? { userId: link.userId, expiresAt: link.expiresAt, usedAt: link.usedAt } : null;
  }

  async consumeDeviceLinkAndCreateDevice(
    tokenHash: string,
    device: AuthDevice,
    usedAt: string,
  ): Promise<boolean> {
    const link = this.links.get(tokenHash);
    if (!link || link.usedAt || link.expiresAt <= usedAt) return false;
    if (await this.findDeviceByPublicKey(device.publicKey)) return false;
    link.usedAt = usedAt;
    this.devices.set(device.id, { ...device, userId: link.userId });
    return true;
  }

  async listDevices(userId: string): Promise<AuthDevice[]> {
    return [...this.devices.values()].filter((device) => device.userId === userId).map((device) => ({ ...device }));
  }

  async revokeDevice(userId: string, deviceId: string, revokedAt: string): Promise<boolean> {
    const device = this.devices.get(deviceId);
    if (!device || device.userId !== userId || device.revokedAt) return false;
    device.revokedAt = revokedAt;
    for (const session of this.sessions.values()) {
      if (session.principal.device.id === deviceId && !session.revokedAt) session.revokedAt = revokedAt;
    }
    return true;
  }
}

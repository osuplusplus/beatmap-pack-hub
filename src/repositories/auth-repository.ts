export interface AuthUser {
  id: string;
  displayName: string;
}

export interface AuthDevice {
  id: string;
  userId: string;
  publicKey: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface AuthPrincipal {
  user: AuthUser;
  device: AuthDevice;
}

export interface AuthChallenge {
  id: string;
  principal: AuthPrincipal;
  message: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface AuthSession {
  principal: AuthPrincipal;
  expiresAt: string;
  revokedAt: string | null;
}

export interface DeviceLink {
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface AuthRepository {
  findDeviceByPublicKey(publicKey: string): Promise<AuthPrincipal | null>;
  createProfileWithDevice(user: AuthUser, device: AuthDevice, now: string): Promise<void>;
  createChallenge(id: string, principal: AuthPrincipal, message: string, expiresAt: string, now: string): Promise<void>;
  findChallenge(id: string): Promise<AuthChallenge | null>;
  consumeChallenge(id: string, usedAt: string): Promise<boolean>;
  createSession(tokenHash: string, principal: AuthPrincipal, expiresAt: string, now: string): Promise<void>;
  findSession(tokenHash: string): Promise<AuthSession | null>;
  revokeSession(tokenHash: string, revokedAt: string): Promise<void>;
  createDeviceLink(tokenHash: string, principal: AuthPrincipal, expiresAt: string, now: string): Promise<void>;
  findDeviceLink(tokenHash: string): Promise<DeviceLink | null>;
  consumeDeviceLinkAndCreateDevice(tokenHash: string, device: AuthDevice, usedAt: string): Promise<boolean>;
  listDevices(userId: string): Promise<AuthDevice[]>;
  revokeDevice(userId: string, deviceId: string, revokedAt: string): Promise<boolean>;
}

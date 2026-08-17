import type {
  AuthChallenge,
  AuthDevice,
  AuthPrincipal,
  AuthRepository,
  AuthSession,
  AuthUser,
  DeviceLink,
} from "./auth-repository";

interface PrincipalRow {
  user_id: string;
  display_name: string;
  device_id: string;
  public_key: string;
  device_name: string;
  created_at: string;
  last_seen_at: string;
  device_revoked_at: string | null;
}

interface ChallengeRow extends PrincipalRow {
  challenge_id: string;
  message: string;
  expires_at: string;
  used_at: string | null;
}

interface SessionRow extends PrincipalRow {
  expires_at: string;
  session_revoked_at: string | null;
}

interface DeviceRow {
  id: string;
  user_id: string;
  public_key: string;
  device_name: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

function principalFromRow(row: PrincipalRow): AuthPrincipal {
  return {
    user: { id: row.user_id, displayName: row.display_name },
    device: {
      id: row.device_id,
      userId: row.user_id,
      publicKey: row.public_key,
      deviceName: row.device_name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.device_revoked_at,
    },
  };
}

function deviceFromRow(row: DeviceRow): AuthDevice {
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

const PRINCIPAL_SELECT = `
  SELECT u.id AS user_id, u.display_name,
         d.id AS device_id, d.public_key, d.device_name,
         d.created_at, d.last_seen_at, d.revoked_at AS device_revoked_at
  FROM user_devices d JOIN users u ON u.id = d.user_id
`;

export class D1AuthRepository implements AuthRepository {
  constructor(private readonly db: D1Database) {}

  async findDeviceByPublicKey(publicKey: string): Promise<AuthPrincipal | null> {
    const row = await this.db.prepare(`${PRINCIPAL_SELECT} WHERE d.public_key = ? LIMIT 1`)
      .bind(publicKey).first<PrincipalRow>();
    return row ? principalFromRow(row) : null;
  }

  async createProfileWithDevice(user: AuthUser, device: AuthDevice, now: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO users (id, public_key, display_name, created_at) VALUES (?, NULL, ?, ?)
      `).bind(user.id, user.displayName, now),
      this.db.prepare(`
        INSERT INTO user_devices
          (id, user_id, public_key, device_name, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(device.id, user.id, device.publicKey, device.deviceName, now, now),
    ]);
  }

  async createChallenge(
    id: string,
    principal: AuthPrincipal,
    message: string,
    expiresAt: string,
    now: string,
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO auth_challenges
        (id, user_id, device_id, message, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, principal.user.id, principal.device.id, message, expiresAt, now).run();
  }

  async findChallenge(id: string): Promise<AuthChallenge | null> {
    const row = await this.db.prepare(`
      SELECT c.id AS challenge_id, c.message, c.expires_at, c.used_at,
             u.id AS user_id, u.display_name,
             d.id AS device_id, d.public_key, d.device_name,
             d.created_at, d.last_seen_at, d.revoked_at AS device_revoked_at
      FROM auth_challenges c
      JOIN users u ON u.id = c.user_id
      JOIN user_devices d ON d.id = c.device_id
      WHERE c.id = ?
    `).bind(id).first<ChallengeRow>();
    return row ? {
      id: row.challenge_id,
      principal: principalFromRow(row),
      message: row.message,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
    } : null;
  }

  async consumeChallenge(id: string, usedAt: string): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?
    `).bind(usedAt, id, usedAt).run();
    return result.meta.changes === 1;
  }

  async createSession(tokenHash: string, principal: AuthPrincipal, expiresAt: string, now: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO auth_sessions (token_hash, user_id, device_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(tokenHash, principal.user.id, principal.device.id, expiresAt, now),
      this.db.prepare("UPDATE user_devices SET last_seen_at = ? WHERE id = ?")
        .bind(now, principal.device.id),
    ]);
  }

  async findSession(tokenHash: string): Promise<AuthSession | null> {
    const row = await this.db.prepare(`
      SELECT s.expires_at, s.revoked_at AS session_revoked_at,
             u.id AS user_id, u.display_name,
             d.id AS device_id, d.public_key, d.device_name,
             d.created_at, d.last_seen_at, d.revoked_at AS device_revoked_at
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      JOIN user_devices d ON d.id = s.device_id
      WHERE s.token_hash = ?
    `).bind(tokenHash).first<SessionRow>();
    return row ? {
      principal: principalFromRow(row),
      expiresAt: row.expires_at,
      revokedAt: row.session_revoked_at,
    } : null;
  }

  async revokeSession(tokenHash: string, revokedAt: string): Promise<void> {
    await this.db.prepare(`
      UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL
    `).bind(revokedAt, tokenHash).run();
  }

  async createDeviceLink(
    tokenHash: string,
    principal: AuthPrincipal,
    expiresAt: string,
    now: string,
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO device_link_tokens
        (token_hash, user_id, issued_by_device_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(tokenHash, principal.user.id, principal.device.id, expiresAt, now).run();
  }

  async findDeviceLink(tokenHash: string): Promise<DeviceLink | null> {
    const row = await this.db.prepare(`
      SELECT user_id, expires_at, used_at FROM device_link_tokens WHERE token_hash = ?
    `).bind(tokenHash).first<{ user_id: string; expires_at: string; used_at: string | null }>();
    return row ? { userId: row.user_id, expiresAt: row.expires_at, usedAt: row.used_at } : null;
  }

  async consumeDeviceLinkAndCreateDevice(
    tokenHash: string,
    device: AuthDevice,
    usedAt: string,
  ): Promise<boolean> {
    const results = await this.db.batch([
        this.db.prepare(`
          INSERT INTO user_devices
            (id, user_id, public_key, device_name, created_at, last_seen_at)
          SELECT ?, user_id, ?, ?, ?, ? FROM device_link_tokens
          WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
        `).bind(device.id, device.publicKey, device.deviceName, usedAt, usedAt, tokenHash, usedAt),
        this.db.prepare(`
          UPDATE device_link_tokens SET used_at = ?
          WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
            AND EXISTS (SELECT 1 FROM user_devices WHERE id = ?)
        `).bind(usedAt, tokenHash, usedAt, device.id),
    ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1;
  }

  async listDevices(userId: string): Promise<AuthDevice[]> {
    const rows = await this.db.prepare(`
      SELECT id, user_id, public_key, device_name, created_at, last_seen_at, revoked_at
      FROM user_devices WHERE user_id = ? ORDER BY created_at ASC
    `).bind(userId).all<DeviceRow>();
    return rows.results.map(deviceFromRow);
  }

  async revokeDevice(userId: string, deviceId: string, revokedAt: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare(`
        UPDATE user_devices SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
      `).bind(revokedAt, deviceId, userId),
      this.db.prepare(`
        UPDATE auth_sessions SET revoked_at = ?
        WHERE device_id = ? AND revoked_at IS NULL
      `).bind(revokedAt, deviceId),
    ]);
    return results[0].meta.changes === 1;
  }
}

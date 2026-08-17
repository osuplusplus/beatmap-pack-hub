export const LIMITS = {
  titleMaxLength: 120,
  descriptionMaxLength: 2_000,
  maxBeatmapsetCount: 500,
  maxRequestBodyBytes: 64 * 1024,
} as const;

export const SHARE_ID = {
  length: 6,
  alphabet: "23456789ABCDEFGHJKMNPQRSTUVWXYZ",
  maxAttempts: 8,
} as const;

export const AUTH = {
  domainSeparation: "OPP_BPH_LOGIN_V1",
  handshakeDomainSeparation: "OPP_BPH_HANDSHAKE_V1",
  deviceLinkDomainSeparation: "OPP_BPH_LINK_DEVICE_V1",
  challengeTtlMs: 5 * 60 * 1_000,
  deviceLinkTtlMs: 10 * 60 * 1_000,
  sessionTtlMs: 60 * 60 * 1_000,
} as const;

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

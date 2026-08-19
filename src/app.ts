import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { ZodError, type ZodType } from "zod";
import { LIMITS } from "./config";
import { AppError } from "./errors";
import { D1AuthRepository } from "./repositories/d1-auth-repository";
import type { AuthRepository } from "./repositories/auth-repository";
import { D1PackRepository } from "./repositories/d1-pack-repository";
import type { PackRepository } from "./repositories/pack-repository";
import { PackService } from "./services/pack-service";
import { AuthService } from "./services/auth-service";
import type { Env } from "./types";
import {
  challengeSchema,
  createPackSchema,
  handshakeSchema,
  linkDeviceSchema,
  ratingSchema,
  updatePackSchema,
  verifySchema,
} from "./validation";

type RepositoryFactory = (env: Env) => PackRepository;
type AuthRepositoryFactory = (env: Env) => AuthRepository;

function normalizeShareId(raw: string): string | null {
  const normalized = raw.trim().toUpperCase().replace(/^BPH-/, "");
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(normalized) ? normalized : null;
}

function bearerToken(headers: Headers): string | null {
  const authorization = headers.get("Authorization")?.trim();
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match) throw new AppError(401, "INVALID_SESSION", "Authorization must contain a valid Bearer token");
  return match[1];
}

async function identity(
  headers: Headers,
  env: Env,
  auth: AuthService,
  required: boolean,
): Promise<string | null> {
  const token = bearerToken(headers);
  if (token) return (await auth.authenticate(token)).user.id;

  const developmentId = headers.get("X-BPH-User-ID")?.trim();
  if (developmentId) {
    if (env.ALLOW_DEV_AUTH !== "true") {
      throw new AppError(401, "DEV_AUTH_DISABLED", "Development identity authentication is disabled");
    }
    return developmentId;
  }
  if (required) throw new AppError(401, "AUTH_REQUIRED", "A Bearer session is required");
  return null;
}

function requireJson(request: Request): void {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const isJson = mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
  if (!isJson) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
}

async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  requireJson(request);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > LIMITS.maxRequestBodyBytes) {
    throw new AppError(413, "BODY_TOO_LARGE", "Request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > LIMITS.maxRequestBodyBytes) {
    throw new AppError(413, "BODY_TOO_LARGE", "Request body is too large");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  return schema.parse(json);
}

function requireShareId(raw: string): string {
  const id = normalizeShareId(raw);
  if (!id) throw new AppError(400, "INVALID_SHARE_ID", "Invalid BeatmapPackHub share ID");
  return id;
}

export function createApp(
  repositoryFactory: RepositoryFactory = (env) => new D1PackRepository(env.DB),
  authRepositoryFactory: AuthRepositoryFactory = (env) => new D1AuthRepository(env.DB),
) {
  const app = new Hono<{ Bindings: Env }>();
  const service = (env: Env) => new PackService(repositoryFactory(env));
  const authService = (env: Env) => new AuthService(authRepositoryFactory(env));

  app.use("*", async (c, next) => {
    c.header("X-Request-ID", crypto.randomUUID());
    await next();
  });

  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-BPH-User-ID", "X-Request-ID"],
    exposeHeaders: ["X-Request-ID"],
    maxAge: 86_400,
  }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/api/v1", (c) => c.json({
    name: "BeatmapPackHub",
    api_version: 1,
    auth: {
      mode: "ed25519-challenge",
      algorithm: "Ed25519",
      session_scheme: "Bearer",
      development_header_enabled: c.env.ALLOW_DEV_AUTH === "true",
    },
    features: ["packs", "pack_recommendations", "private_packs", "ratings", "favorites", "likes", "comments", "viewer_state", "challenge_auth", "multi_device"],
    limits: {
      title_length: LIMITS.titleMaxLength,
      description_length: LIMITS.descriptionMaxLength,
      beatmapsets_per_pack: LIMITS.maxBeatmapsetCount,
      request_body_bytes: LIMITS.maxRequestBodyBytes,
    },
  }));

  app.post("/api/v1/auth/handshake", async (c) => {
    const input = await parseBody(c.req.raw, handshakeSchema);
    return c.json(await authService(c.env).handshake(
      input.public_key,
      input.display_name,
      input.device_name,
      input.signature,
    ), 201);
  });

  app.post("/api/v1/auth/challenge", async (c) => {
    const input = await parseBody(c.req.raw, challengeSchema);
    return c.json(await authService(c.env).challenge(input.public_key));
  });

  app.post("/api/v1/auth/verify", async (c) => {
    const input = await parseBody(c.req.raw, verifySchema);
    return c.json(await authService(c.env).verify(input.challenge_id, input.signature));
  });

  app.post("/api/v1/auth/logout", async (c) => {
    const token = bearerToken(c.req.raw.headers);
    if (!token) throw new AppError(401, "AUTH_REQUIRED", "A Bearer session is required");
    await authService(c.env).authenticate(token);
    await authService(c.env).logout(token);
    return c.body(null, 204);
  });

  app.post("/api/v1/auth/device-links", async (c) => {
    const token = bearerToken(c.req.raw.headers);
    if (!token) throw new AppError(401, "AUTH_REQUIRED", "A Bearer session is required");
    const auth = authService(c.env);
    return c.json(await auth.createDeviceLink(await auth.authenticate(token)), 201);
  });

  app.post("/api/v1/auth/devices/link", async (c) => {
    const input = await parseBody(c.req.raw, linkDeviceSchema);
    return c.json(await authService(c.env).linkDevice(
      input.link_token,
      input.public_key,
      input.device_name,
      input.signature,
    ), 201);
  });

  app.get("/api/v1/auth/me", async (c) => {
    const token = bearerToken(c.req.raw.headers);
    if (!token) throw new AppError(401, "AUTH_REQUIRED", "A Bearer session is required");
    const auth = authService(c.env);
    return c.json(await auth.profile(await auth.authenticate(token)));
  });

  app.delete("/api/v1/auth/devices/:deviceId", async (c) => {
    const token = bearerToken(c.req.raw.headers);
    if (!token) throw new AppError(401, "AUTH_REQUIRED", "A Bearer session is required");
    const auth = authService(c.env);
    await auth.revokeDevice(await auth.authenticate(token), c.req.param("deviceId"));
    return c.body(null, 204);
  });

  app.post("/api/v1/packs", async (c) => {
    const input = await parseBody(c.req.raw, createPackSchema);
    const userId = await identity(c.req.raw.headers, c.env, authService(c.env), true);
    return c.json(await service(c.env).create(userId!, input), 201);
  });

  const recommendations = async (c: Context<{ Bindings: Env }>) => {
    c.header("Cache-Control", "public, max-age=60");
    const rawLimit = Number(c.req.query("limit") ?? 20);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
    return c.json({ packs: await service(c.env).recommendations(limit) });
  };
  app.get("/api/v1/packs/recommendations", recommendations);
  app.get("/api/v1/recommendations", recommendations);

  app.get("/api/v1/packs/:shareId", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Vary", "X-BPH-User-ID, Origin");
    const viewerId = await identity(c.req.raw.headers, c.env, authService(c.env), false);
    return c.json(await service(c.env).get(requireShareId(c.req.param("shareId")), viewerId));
  });

  app.patch("/api/v1/packs/:shareId", async (c) => {
    const input = await parseBody(c.req.raw, updatePackSchema);
    const userId = await identity(c.req.raw.headers, c.env, authService(c.env), true);
    await service(c.env).update(userId!, requireShareId(c.req.param("shareId")), input);
    return c.body(null, 204);
  });

  app.delete("/api/v1/packs/:shareId", async (c) => {
    const userId = await identity(c.req.raw.headers, c.env, authService(c.env), true);
    await service(c.env).delete(userId!, requireShareId(c.req.param("shareId")));
    return c.body(null, 204);
  });

  app.put("/api/v1/packs/:shareId/rating", async (c) => {
    const input = await parseBody(c.req.raw, ratingSchema);
    const userId = await identity(c.req.raw.headers, c.env, authService(c.env), true);
    await service(c.env).rate(userId!, requireShareId(c.req.param("shareId")), input.score);
    return c.body(null, 204);
  });

  app.put("/api/v1/packs/:shareId/favorite", async (c) => {
    const userId = await identity(c.req.raw.headers, c.env, authService(c.env), true);
    await service(c.env).favorite(userId!, requireShareId(c.req.param("shareId")), true);
    return c.body(null, 204);
  });

  app.delete("/api/v1/packs/:shareId/favorite", async (c) => {
    const userId = await identity(c.req.raw.headers, c.env, authService(c.env), true);
    await service(c.env).favorite(userId!, requireShareId(c.req.param("shareId")), false);
    return c.body(null, 204);
  });

  app.notFound((c) => c.json({ error: { code: "ROUTE_NOT_FOUND", message: "Route not found" } }, 404));

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof ZodError) {
      return c.json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      }, 422);
    }
    console.error("Unhandled request error", error);
    return c.json({ error: { code: "INTERNAL_ERROR", message: "An internal error occurred" } }, 500);
  });

  return app;
}

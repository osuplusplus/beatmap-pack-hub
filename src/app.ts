import { Hono } from "hono";
import { ZodError, type ZodType } from "zod";
import { LIMITS } from "./config";
import { AppError } from "./errors";
import { D1PackRepository } from "./repositories/d1-pack-repository";
import type { PackRepository } from "./repositories/pack-repository";
import { PackService } from "./services/pack-service";
import type { Env } from "./types";
import { createPackSchema, ratingSchema, updatePackSchema } from "./validation";

type RepositoryFactory = (env: Env) => PackRepository;

function normalizeShareId(raw: string): string | null {
  const normalized = raw.trim().toUpperCase().replace(/^BPH-/, "");
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(normalized) ? normalized : null;
}

function userId(headers: Headers): string {
  const value = headers.get("X-BPH-User-ID")?.trim();
  if (!value) throw new AppError(401, "AUTH_REQUIRED", "X-BPH-User-ID is required during Phase 1 authentication");
  return value;
}

async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
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

export function createApp(repositoryFactory: RepositoryFactory = (env) => new D1PackRepository(env.DB)) {
  const app = new Hono<{ Bindings: Env }>();
  const service = (env: Env) => new PackService(repositoryFactory(env));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/api/v1/packs", async (c) => {
    const input = await parseBody(c.req.raw, createPackSchema);
    return c.json(await service(c.env).create(userId(c.req.raw.headers), input), 201);
  });

  app.get("/api/v1/packs/:shareId", async (c) =>
    c.json(await service(c.env).get(requireShareId(c.req.param("shareId")))));

  app.patch("/api/v1/packs/:shareId", async (c) => {
    const input = await parseBody(c.req.raw, updatePackSchema);
    await service(c.env).update(userId(c.req.raw.headers), requireShareId(c.req.param("shareId")), input);
    return c.body(null, 204);
  });

  app.delete("/api/v1/packs/:shareId", async (c) => {
    await service(c.env).delete(userId(c.req.raw.headers), requireShareId(c.req.param("shareId")));
    return c.body(null, 204);
  });

  app.put("/api/v1/packs/:shareId/rating", async (c) => {
    const input = await parseBody(c.req.raw, ratingSchema);
    await service(c.env).rate(userId(c.req.raw.headers), requireShareId(c.req.param("shareId")), input.score);
    return c.body(null, 204);
  });

  app.put("/api/v1/packs/:shareId/favorite", async (c) => {
    await service(c.env).favorite(userId(c.req.raw.headers), requireShareId(c.req.param("shareId")), true);
    return c.body(null, 204);
  });

  app.delete("/api/v1/packs/:shareId/favorite", async (c) => {
    await service(c.env).favorite(userId(c.req.raw.headers), requireShareId(c.req.param("shareId")), false);
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

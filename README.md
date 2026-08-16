# BeatmapPackHub

BeatmapPackHub is a Cloudflare Workers registry for sharing ordered osu! beatmapset ID lists with OPP. It stores pack metadata and community state; it never stores or proxies `.osz`, `.osu`, audio, backgrounds, or download URLs.

## MVP architecture

- TypeScript + Hono on Cloudflare Workers
- Cloudflare D1 with SQL migrations
- Thin HTTP routes, `PackService` business logic, and a replaceable repository layer
- Random six-character human-safe share IDs (`BPH-` is a display prefix)
- Ordered, first-occurrence deduplication of `beatmapset_id` values
- SHA-256 manifest hash separate from pack identity
- Owner-only edit/delete, rating upsert, and idempotent favorites

Phase 1 uses an explicit `X-BPH-User-ID` request header. Migration `0001_initial.sql` creates the local `dev-user`. This boundary is intentionally isolated so a later Ed25519 challenge-response session can replace it without changing pack business logic. Never use this development identity scheme as production authentication.

## Local setup

Prerequisites: Node.js 20+ and npm.

```sh
npm install
npm run db:migrate:local
npm run dev
```

Before remote deployment, create a D1 database and replace `database_id` in `wrangler.jsonc`:

```sh
npx wrangler d1 create beatmap-pack-hub
npm run db:migrate:remote
npm run deploy
```

## Core flow

Create a pack:

```sh
curl -X POST http://localhost:8787/api/v1/packs \
  -H "Content-Type: application/json" \
  -H "X-BPH-User-ID: dev-user" \
  -d '{"title":"Tech Training","description":"My tech collection","beatmapset_ids":[123456,234567,123456]}'
```

The response is `{"id":"7K3N9A"}`. Fetch it using either the raw ID or display form:

```sh
curl http://localhost:8787/api/v1/packs/BPH-7K3N9A
```

Mutation endpoints require `X-BPH-User-ID`:

- `PATCH /api/v1/packs/:share_id`
- `DELETE /api/v1/packs/:share_id`
- `PUT /api/v1/packs/:share_id/rating`
- `PUT /api/v1/packs/:share_id/favorite`
- `DELETE /api/v1/packs/:share_id/favorite`

All failures use `{ "error": { "code": "...", "message": "..." } }`. Validation failures also include safe field-level details. Internal database errors are logged by the Worker and returned only as `INTERNAL_ERROR`.

## Validation limits

Limits are centralized in `src/config.ts`: title 120 characters, description 2,000 characters, 500 beatmapsets per pack, and 64 KiB request bodies. Beatmapset IDs must be positive safe integers.

## Verification

```sh
npm run typecheck
npm test
```

Tests cover share IDs and hashes, ordered deduplication, create/get, owner authorization, update/delete, rating overwrite, favorites, validation, and 404 responses.

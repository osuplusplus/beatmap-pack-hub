# BeatmapPackHub

BeatmapPackHub 是一个面向 osu! 玩家、并计划与桌面客户端 **OPP** 联动的社区曲包分享平台。

它不托管谱面文件。服务端只保存一组有序的 `beatmapset_id`，并生成一个短且唯一的分享 ID。其他玩家将分享 ID 输入 OPP 后，OPP 从 BeatmapPackHub 获取列表、检查本地谱面，并自行下载缺失部分。

```text
玩家 A 在 OPP 选择谱面
          ↓
上传有序的 BeatmapSet ID 列表
          ↓
BeatmapPackHub 返回 BPH-7K3N9A
          ↓
玩家 B 在 OPP 输入分享码
          ↓
服务端返回 BeatmapSet ID 列表
          ↓
OPP 检查本地并下载缺失谱面
```

> [!WARNING]
> Ed25519 Challenge-Response 已实现。`X-BPH-User-ID` 只是在 `ALLOW_DEV_AUTH=true` 时启用的联调兼容方式；公开部署前必须将其设为 `false`，并始终使用 HTTPS。

## 核心原则

BeatmapPackHub 的本质是：

```text
Pack ID Registry
+ Pack Metadata
+ Owner
+ Community Rating
+ Favorite
```

而不是 Beatmap CDN。

### Server 负责

- 保存 Pack、owner 和元数据
- 保存有顺序的 `beatmapset_id` 列表
- 生成不可预测的分享 ID
- 计算内容 `manifest_hash`
- 修改与删除的 owner 权限检查
- 社区评分与收藏
- 提供带版本前缀的 HTTP API

### OPP Client 负责

- 读取 osu! 本地 Songs 和 Collection
- 将本地谱面转换为 `beatmapset_id`
- 创建 Pack 或读取分享 ID
- 检查本地已有和缺失谱面
- 选择 Download Provider
- 下载、导入 `.osz`
- 处理未来的 `opp://pack/:share_id` Deep Link

### Server 明确不负责

- 不托管 `.osz`、`.osu`、音频或背景图片
- 不代理任何 Beatmap 下载
- 不返回第三方 `download_url`
- 不操作用户本地 osu! Songs 目录
- 不在 Pack 写入流程中调用 osu! API
- 不使用 osu! OAuth

## 当前实现状态

第一阶段 MVP 已实现：

- [x] 创建和获取 Pack
- [x] owner 修改、删除 Pack
- [x] 随机 6 位人工可输入分享 ID
- [x] 接受 `7K3N9A` 和展示形式 `BPH-7K3N9A`
- [x] BeatmapSet ID 保序去重
- [x] SHA-256 `manifest_hash`
- [x] 评分覆盖更新
- [x] 收藏与取消收藏
- [x] D1 migration、外键和索引
- [x] 请求体及字段限制
- [x] 统一 JSON 错误结构
- [x] OPP 能力发现、CORS 预检和请求追踪 ID
- [x] 当前用户的评分、收藏及编辑权限状态
- [x] 首次握手建档、Ed25519 Challenge、Bearer Session 与多设备管理
- [x] 单元测试和 API 集成测试
- [x] Cloudflare Workers 部署配置

后续规划：

- [ ] Pack Version
- [ ] Comments、Tags、Search、Trending
- [ ] 举报、统计、关注和通知
- [ ] 可选的 Beatmap Metadata 异步缓存
- [ ] OPP Deep Link 联动

## 技术栈

- TypeScript
- Hono
- Cloudflare Workers
- Cloudflare D1
- Zod
- Vitest
- Wrangler

项目采用薄路由、Service 和 Repository 分层。HTTP、业务规则与 D1 SQL 相互隔离，便于以后替换认证方式以及增加 Pack Version。

```text
src/
├── app.ts                              HTTP 路由、请求解析和统一错误
├── config.ts                           集中管理输入限制和分享码配置
├── domain/                             分享码、manifest hash 和编码工具
├── repositories/
│   ├── pack-repository.ts              数据访问接口
│   ├── d1-pack-repository.ts           Pack D1 实现
│   └── d1-auth-repository.ts           认证 D1 实现
├── services/                           Pack 业务与 Challenge 认证
├── validation.ts                       Zod 输入验证
└── index.ts                            Worker 入口

migrations/0001_initial.sql             D1 Schema
migrations/0002_challenge_auth.sql      Challenge 与 Session Schema
migrations/0003_multi_device.sql         用户档案与多设备 Schema
test/                                   单元测试和 API 集成测试
```

## 数据设计

MVP 包含以下表：

```text
users
├── id
├── display_name
└── created_at

user_devices
├── id
├── user_id
├── public_key
├── device_name
├── last_seen_at
└── revoked_at

packs
├── id                 内部 UUID
├── share_id           对外分享 ID
├── owner_id
├── title
├── description
├── manifest_hash
├── created_at
└── updated_at

pack_items
├── pack_id
├── beatmapset_id
└── position

ratings
├── pack_id
├── user_id
├── score
├── created_at
└── updated_at

favorites
├── pack_id
├── user_id
└── created_at

auth_challenges
├── id
├── user_id
├── device_id
├── message
├── expires_at
└── used_at

auth_sessions
├── token_hash
├── user_id
├── device_id
├── expires_at
└── revoked_at

device_link_tokens
├── token_hash
├── user_id
├── issued_by_device_id
├── expires_at
└── used_at
```

Pack Item 使用 `beatmapset_id`，因为 `.osz` 的下载单位通常是完整 BeatmapSet，而不是单个 Difficulty。

`position` 会保存用户提交顺序。同一个 Pack 中重复 ID 会被删除，但只保留第一次出现的位置，不会排序列表。

### Pack ID 与 Manifest Hash

二者具有不同含义：

```text
share_id      = 社区对象身份，例如 7K3N9A
manifest_hash = 有序 BeatmapSet ID 列表的内容身份
```

两个用户可以发布内容完全相同但标题、用途和社区状态不同的 Pack，因此分享 ID 不直接使用 manifest hash。

分享码字符集排除了容易混淆的 `0/O/1/I/L`。`BPH-` 只是展示前缀，数据库保存的是 6 位 `share_id`。

## 本地开发

要求 Node.js 22 或更高版本。项目统一使用 npm；`.node-version` 和 `packageManager` 用于确保本地与 Cloudflare Builds 使用一致运行时。

```bash
npm install
npm run db:migrate:local
npm run dev
```

默认本地地址：

```text
http://localhost:8787
```

健康检查：

```bash
curl http://localhost:8787/health
```

预期响应：

```json
{
  "status": "ok"
}
```

迁移会创建开发身份：

```text
id: dev-user
display_name: Local Developer
```

## API

API Base Path：

```text
/api/v1
```

认证成功后，Pack、评分、收藏和设备管理等受保护接口要求：

```http
Authorization: Bearer <access_token>
```

本地联调仍可在 `ALLOW_DEV_AUTH=true` 时使用 `X-BPH-User-ID: dev-user`。

### OPP 联调入口

```http
GET /api/v1
```

该接口返回 API 版本、认证方式、可用功能和输入限制。OPP 可以在启动联调时先调用它，尽早发现服务地址或协议版本配置错误。

所有响应都会包含 `X-Request-ID`，出现服务端错误时可将该值与 Worker Logs 对照。API 支持跨域预检，允许 `Authorization`、`Content-Type`、`X-BPH-User-ID` 和 `X-Request-ID` 请求头。

当前联调建议配置：

```text
Base URL: http://127.0.0.1:8787/api/v1
Session header: Authorization: Bearer <access_token>
```

部署后只需将 Base URL 换成 HTTPS Worker 地址。认证不使用 Cookie，OPP 每次写请求以及需要 `viewer` 状态的读请求都应显式发送 Bearer Session。

### 创建 Pack

```http
POST /api/v1/packs
Content-Type: application/json
Authorization: Bearer <access_token>
```

请求：

```json
{
  "title": "Tech Training",
  "description": "My tech collection",
  "beatmapset_ids": [123456, 234567, 123456, 345678]
}
```

成功状态：`201 Created`

```json
{
  "id": "7K3N9A"
}
```

服务端保存的实际顺序为：

```json
[123456, 234567, 345678]
```

### 获取 Pack

```http
GET /api/v1/packs/:share_id
```

`share_id` 可以使用 `7K3N9A` 或 `BPH-7K3N9A`，大小写不敏感。

成功状态：`200 OK`

```json
{
  "id": "7K3N9A",
  "title": "Tech Training",
  "description": "My tech collection",
  "owner": {
    "id": "dev-user",
    "display_name": "Local Developer"
  },
  "beatmapset_ids": [123456, 234567, 345678],
  "manifest_hash": "sha256-hex-value",
  "rating": {
    "average": null,
    "count": 0
  },
  "created_at": "2026-08-16T12:00:00.000Z",
  "updated_at": "2026-08-16T12:00:00.000Z"
}
```

没有评分时 `average` 为 `null`。

如果请求携带有效的 Bearer Session，响应还会增加当前用户状态：

```json
{
  "viewer": {
    "rating": 5,
    "favorited": true,
    "can_edit": true
  }
}
```

未评分时 `viewer.rating` 为 `null`。不携带认证信息时 Pack 仍可公开读取，但不会返回 `viewer` 字段。Pack 读取响应使用 `Cache-Control: no-store`，避免不同用户状态被错误复用。

### 修改 Pack

```http
PATCH /api/v1/packs/:share_id
Content-Type: application/json
Authorization: Bearer <access_token>
```

所有字段均可选，但至少需要提交一个字段：

```json
{
  "title": "Updated Tech Pack",
  "description": "Updated description",
  "beatmapset_ids": [999, 888, 999]
}
```

只有 owner 可以修改。成功状态：`204 No Content`。

### 删除 Pack

```http
DELETE /api/v1/packs/:share_id
Authorization: Bearer <access_token>
```

只有 owner 可以删除。当前 MVP 使用硬删除，D1 外键会级联删除 items、ratings 和 favorites。

成功状态：`204 No Content`。

### 提交或修改评分

```http
PUT /api/v1/packs/:share_id/rating
Content-Type: application/json
Authorization: Bearer <access_token>
```

```json
{
  "score": 5
}
```

分数必须是 `1` 至 `5` 的整数。一个用户对一个 Pack 只有一条评分，再次提交会覆盖旧分数。

成功状态：`204 No Content`。

### 收藏 Pack

```http
PUT /api/v1/packs/:share_id/favorite
Authorization: Bearer <access_token>
```

重复收藏是幂等操作。成功状态：`204 No Content`。

### 取消收藏

```http
DELETE /api/v1/packs/:share_id/favorite
Authorization: Bearer <access_token>
```

重复取消也是幂等操作。成功状态：`204 No Content`。

## 错误格式

所有 API 错误使用统一结构：

```json
{
  "error": {
    "code": "PACK_NOT_FOUND",
    "message": "Pack not found"
  }
}
```

输入验证失败会包含安全的字段信息：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "path": "title",
        "message": "Too small: expected string to have >=1 characters"
      }
    ]
  }
}
```

常见错误：

| HTTP | Code | 含义 |
|---:|---|---|
| 400 | `INVALID_JSON` | 请求体不是有效 JSON |
| 400 | `INVALID_SHARE_ID` | 分享 ID 格式错误 |
| 400 | `INVALID_PUBLIC_KEY` | Ed25519 公钥编码无效 |
| 401 | `AUTH_REQUIRED` | 缺少 Bearer Session |
| 401 | `AUTH_FAILED` | 公钥尚未注册 |
| 401 | `INVALID_CHALLENGE` | Challenge 无效、过期或已使用 |
| 401 | `INVALID_SIGNATURE` | Ed25519 签名验证失败 |
| 401 | `INVALID_SESSION` | Session 无效、过期或已注销 |
| 401 | `INVALID_DEVICE_LINK` | 设备链接凭证无效、过期或已使用 |
| 401 | `DEV_AUTH_DISABLED` | 当前环境不允许开发身份头 |
| 401 | `UNKNOWN_IDENTITY` | D1 中不存在该用户 |
| 409 | `DEVICE_REGISTERED` | 设备公钥已经登记 |
| 409 | `CANNOT_REVOKE_CURRENT_DEVICE` | 当前设备不能撤销自身 |
| 403 | `NOT_PACK_OWNER` | 当前用户不是 Pack owner |
| 404 | `PACK_NOT_FOUND` | Pack 不存在 |
| 404 | `DEVICE_NOT_FOUND` | 设备不存在或不属于当前用户 |
| 404 | `ROUTE_NOT_FOUND` | API 路由不存在 |
| 413 | `BODY_TOO_LARGE` | 请求体超过限制 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | JSON 写接口未声明 JSON Content-Type |
| 422 | `VALIDATION_ERROR` | 字段验证失败 |
| 500 | `INTERNAL_ERROR` | 未公开内部信息的服务器错误 |

数据库原始错误只记录到 Worker Logs，对客户端始终返回通用 `INTERNAL_ERROR`。

## 输入限制

限制集中定义在 `src/config.ts`：

| 项目 | 当前限制 |
|---|---:|
| title | 1–120 字符 |
| description | 最多 2,000 字符 |
| 单个 Pack 的 BeatmapSet 数量 | 1–500 个 |
| beatmapset_id | 正安全整数 |
| Request Body | 最多 64 KiB |
| Rating | 1–5 的整数 |

生产环境还应在 Cloudflare 层配置 Rate Limiting、WAF 和必要的请求日志策略。

## 部署到 Cloudflare

### 1. 创建 D1

在 Cloudflare Dashboard 中打开：

```text
Storage & databases
→ D1 SQL database
→ Create database
```

数据库名称填写 `beatmap-pack-hub`。复制创建后的 Database ID，并替换 `wrangler.jsonc` 中的占位值：

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "beatmap-pack-hub",
      "database_id": "你的真实-database-id"
    }
  ]
}
```

提交并推送修改。

### 2. 从 Git 仓库部署 Worker

在 Dashboard 中打开：

```text
Workers & Pages
→ Create
→ Import a repository / Connect to Git
```

选择仓库和生产分支，构建设置填写：

| 设置 | 值 |
|---|---|
| Framework preset | `None` |
| Root directory | `/` 或留空 |
| Build command | `npm run typecheck` |
| Deploy command | `npm run deploy` |

本项目不需要填写输出目录。`wrangler deploy` 会自动打包 TypeScript Worker。仓库已通过 `.node-version` 固定 Node 22；如果 Cloudflare 项目设置中手动配置了 `NODE_VERSION`，也必须设为 `22` 或更高版本。

### 3. 应用远程迁移

推荐在本地终端执行：

```bash
npx wrangler login
npm run db:migrate:remote
```

不要把远程数据库迁移配置成每次构建时自动执行的部署命令。

### 4. 检查 Binding

进入已部署 Worker 的 **Settings → Bindings**，确认存在：

```text
Variable name: DB
Type: D1 database
Database: beatmap-pack-hub
```

同时确认环境变量 `ALLOW_DEV_AUTH=false`。仓库默认已经关闭开发身份头；只有受控的本地兼容测试才应临时启用它。

## 测试线上部署

以下示例使用 Windows PowerShell。先替换 Worker 地址：

```powershell
$baseUrl = "https://你的-worker地址.workers.dev"
$accessToken = "登录后返回的 access_token"
$headers = @{ "Authorization" = "Bearer $accessToken" }
```

健康检查：

```powershell
Invoke-RestMethod "$baseUrl/health"
```

创建 Pack：

```powershell
$body = @{
    title = "Tech Training"
    description = "Cloudflare deployment test"
    beatmapset_ids = @(123456, 234567, 123456, 345678)
} | ConvertTo-Json

$created = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/api/v1/packs" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $body

$packId = $created.id
$created
```

获取并检查 Pack：

```powershell
Invoke-RestMethod "$baseUrl/api/v1/packs/BPH-$packId" |
    ConvertTo-Json -Depth 5
```

提交评分：

```powershell
Invoke-RestMethod `
    -Method Put `
    -Uri "$baseUrl/api/v1/packs/$packId/rating" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body '{"score":5}'
```

删除测试 Pack：

```powershell
Invoke-RestMethod `
    -Method Delete `
    -Uri "$baseUrl/api/v1/packs/$packId" `
    -Headers $headers
```

如果 `/health` 正常但 Pack 写入返回 `500`，检查：

1. 远程 migration 是否已应用。
2. Worker 的 `DB` Binding 是否指向正确 D1。
3. Dashboard 中 **Observability → Logs** 的服务器日志。

## 测试与质量检查

```bash
npm run typecheck
npm test
```

连接已部署的 Cloudflare Worker（同时验证健康检查和只读 D1 查询）：

```powershell
$env:CF_WORKER_URL = "https://你的-worker地址.workers.dev"
npm run test:link
```

未设置 `CF_WORKER_URL` 时，连接测试会自动跳过，因此 `npm test` 不会依赖线上服务。
测试会自动使用 `HTTP_PROXY` 或 `HTTPS_PROXY` 环境变量，便于在代理网络下连接 Cloudflare。

当前测试覆盖：

- 分享 ID 字符集与长度
- manifest hash 的确定性和顺序敏感性
- BeatmapSet ID 保序去重
- 创建和获取 Pack
- owner 修改与删除权限
- Rating 覆盖更新
- Favorite 幂等操作
- 非法输入和不存在 Pack
- 缺少认证信息
- 首次握手自动创建用户档案和首台设备
- Ed25519 持钥证明与 Challenge 签名
- 多设备链接、列表与定向撤销
- Challenge 重放阻断与 Session 注销
- 内部错误不泄露给客户端

## 用户档案与多设备认证

`users` 表示稳定的用户档案，`user_devices` 表示属于该用户的设备。Pack owner、评分和收藏始终关联 `user_id`，因此同一档案下的多台设备共享社区数据；每台设备拥有独立 Ed25519 Key Pair 和 Session，可单独撤销。

```text
首次设备
生成 Key Pair → 签署 Handshake → 创建用户档案 + 首台设备 + Session

已有设备
Challenge → 签名 → 获取该设备的新 Session

增加设备
旧设备创建一次性 link token → 新设备签署 Link Message
→ 新设备加入同一用户档案并获得独立 Session
```

Challenge 有效期为 5 分钟，设备 link token 有效期为 10 分钟，二者均只能使用一次。Session 有效期为 1 小时，服务端只保存 token 的 SHA-256 哈希。撤销设备会同时撤销该设备的全部 Session，不影响同档案下其他设备。

完整的消息格式、接口请求响应和 OPP 客户端状态机见 [`OPP_AUTH_INTEGRATION.md`](./OPP_AUTH_INTEGRATION.md)。数字签名不能替代 TLS；生产服务始终必须使用 HTTPS。

## OPP Deep Link 规划

未来计划支持：

```text
opp://pack/7K3N9A
```

OPP 收到 Deep Link 后：

```text
解析 share_id
→ 请求 BeatmapPackHub
→ 获取 beatmapset_ids
→ 检查本地谱面
→ 显示总数、已有和缺失数量
→ 用户确认后下载缺失谱面
```

下载来源始终由 OPP 自己决定，BeatmapPackHub API 不提供任何下载 URL。

## npm Scripts

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动本地 Wrangler Worker |
| `npm run deploy` | 部署到 Cloudflare Workers |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行全部测试 |
| `npm run test:watch` | 监听模式运行测试 |
| `npm run db:migrate:local` | 应用本地 D1 migration |
| `npm run db:migrate:remote` | 应用远程 D1 migration |

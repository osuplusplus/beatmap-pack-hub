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
> 当前项目使用 Phase 1 开发身份：客户端通过 `X-BPH-User-ID` 请求头声明用户。它只适合开发、联调和受控测试，不能作为正式生产认证。公开运营前必须接入计划中的 Ed25519 Challenge-Response 认证。

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
- [x] 单元测试和 API 集成测试
- [x] Cloudflare Workers 部署配置

后续规划：

- [ ] Ed25519 公钥注册、Challenge-Response 和 Session
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
├── domain/pack.ts                      分享码、保序去重和 manifest hash
├── repositories/
│   ├── pack-repository.ts              数据访问接口
│   └── d1-pack-repository.ts           D1 实现
├── services/pack-service.ts            Pack 业务规则与权限检查
├── validation.ts                       Zod 输入验证
└── index.ts                            Worker 入口

migrations/0001_initial.sql             D1 Schema
test/                                   单元测试和 API 集成测试
```

## 数据设计

MVP 包含以下表：

```text
users
├── id
├── public_key
├── display_name
└── created_at

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

要求 Node.js 20 或更高版本。

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

当前所有写入接口都要求：

```http
X-BPH-User-ID: dev-user
```

### 创建 Pack

```http
POST /api/v1/packs
Content-Type: application/json
X-BPH-User-ID: dev-user
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

### 修改 Pack

```http
PATCH /api/v1/packs/:share_id
Content-Type: application/json
X-BPH-User-ID: dev-user
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
X-BPH-User-ID: dev-user
```

只有 owner 可以删除。当前 MVP 使用硬删除，D1 外键会级联删除 items、ratings 和 favorites。

成功状态：`204 No Content`。

### 提交或修改评分

```http
PUT /api/v1/packs/:share_id/rating
Content-Type: application/json
X-BPH-User-ID: dev-user
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
X-BPH-User-ID: dev-user
```

重复收藏是幂等操作。成功状态：`204 No Content`。

### 取消收藏

```http
DELETE /api/v1/packs/:share_id/favorite
X-BPH-User-ID: dev-user
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
| 401 | `AUTH_REQUIRED` | 缺少 Phase 1 身份请求头 |
| 401 | `UNKNOWN_IDENTITY` | D1 中不存在该用户 |
| 403 | `NOT_PACK_OWNER` | 当前用户不是 Pack owner |
| 404 | `PACK_NOT_FOUND` | Pack 不存在 |
| 404 | `ROUTE_NOT_FOUND` | API 路由不存在 |
| 413 | `BODY_TOO_LARGE` | 请求体超过限制 |
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
| Deploy command | `npx wrangler deploy` |

本项目不需要填写输出目录。`wrangler deploy` 会自动打包 TypeScript Worker。

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

## 测试线上部署

以下示例使用 Windows PowerShell。先替换 Worker 地址：

```powershell
$baseUrl = "https://你的-worker地址.workers.dev"
$headers = @{ "X-BPH-User-ID" = "dev-user" }
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
- 内部错误不泄露给客户端

## 身份认证路线

当前开发认证仅用于 Phase 1。正式认证计划使用 Ed25519：

```text
OPP 首次启动生成 Ed25519 Key Pair
Private Key 只保存在本地
Public Key 注册到 BeatmapPackHub
          ↓
POST /api/v1/auth/challenge
          ↓
Client 对带 Domain Separation 的消息签名
          ↓
POST /api/v1/auth/verify
          ↓
Server 验证公钥、有效期和一次性 Challenge
          ↓
返回 Session / Token
```

Challenge 必须随机、短时间有效、只能使用一次，并在验证成功后立即失效。协议消息应带类似 `OPP_BPH_LOGIN_V1` 的用途前缀，避免签名跨业务复用。

数字签名不能替代 TLS；生产服务始终必须使用 HTTPS。

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

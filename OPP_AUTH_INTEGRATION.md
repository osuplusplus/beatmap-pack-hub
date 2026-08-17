# OPP ↔ BeatmapPackHub 身份与多设备接入规范

本文档是 OPP 客户端需要实现的 MVP 协议。API Base URL 示例：

```text
https://<worker-host>/api/v1
```

## 1. 客户端必须保存的状态

每台设备独立保存：

- Ed25519 Key Pair；私钥必须进入系统安全存储，不得上传或写入日志。
- `public_key`：原始 32 字节 Ed25519 公钥的无 padding base64url 编码，固定 43 字符。
- `device_id`：服务端为本设备分配的 UUID。
- `user_id`：多设备共享的稳定用户档案 UUID。
- `access_token` 和 `expires_at`；token 不得写入日志。

签名是原始 Ed25519，签名结果为 64 字节，再编码成无 padding base64url，固定 86 字符。所有协议消息使用 UTF-8、LF (`\n`) 分隔，并且末尾没有换行。

## 2. 首次握手：创建用户档案与首台设备

仅在本机没有身份档案时执行。先生成 Ed25519 Key Pair，然后构造：

```text
OPP_BPH_HANDSHAKE_V1\n<public_key>\n<display_name>\n<device_name>
```

将整段 UTF-8 字节签名，并请求：

```http
POST /api/v1/auth/handshake
Content-Type: application/json

{
  "public_key": "<43-char-base64url>",
  "display_name": "Player",
  "device_name": "Desktop PC",
  "signature": "<86-char-base64url>"
}
```

成功：`201 Created`

```json
{
  "access_token": "<43-char-token>",
  "token_type": "Bearer",
  "expires_at": "2026-08-17T12:00:00.000Z",
  "user": {
    "id": "<user-uuid>",
    "display_name": "Player"
  },
  "device": {
    "id": "<device-uuid>",
    "device_name": "Desktop PC"
  }
}
```

保存 `user.id`、`device.id` 和 Session。若返回 `DEVICE_REGISTERED`，说明该公钥已经握手，应进入 Challenge 登录流程，不能生成新档案。

## 3. 已登记设备登录

请求 Challenge：

```http
POST /api/v1/auth/challenge
Content-Type: application/json

{
  "public_key": "<43-char-base64url>"
}
```

成功响应：

```json
{
  "challenge_id": "<uuid>",
  "algorithm": "Ed25519",
  "message": "<base64url-message>",
  "expires_at": "2026-08-17T12:00:00.000Z"
}
```

OPP 必须 base64url 解码 `message`，对解码后的原始字节签名，然后验证：

```http
POST /api/v1/auth/verify
Content-Type: application/json

{
  "challenge_id": "<uuid>",
  "signature": "<86-char-base64url>"
}
```

成功响应与 Handshake 的 Session 响应结构相同。Challenge 有效期 5 分钟且只能成功使用一次。

## 4. Session 使用与续期

需要身份的请求统一携带：

```http
Authorization: Bearer <access_token>
```

Session 有效期 1 小时。当前没有 refresh token；OPP 应在 Session 即将过期或收到 `INVALID_SESSION` 后，使用本设备 Key Pair 重新执行 Challenge 登录。不要因普通网络错误删除本地 Key Pair。

注销当前 Session：

```http
POST /api/v1/auth/logout
Authorization: Bearer <access_token>
```

成功返回 `204 No Content`。

## 5. 添加第二台设备

### 5.1 已登录设备创建链接凭证

```http
POST /api/v1/auth/device-links
Authorization: Bearer <existing-device-token>
```

成功：`201 Created`

```json
{
  "link_token": "<43-char-secret>",
  "expires_at": "2026-08-17T12:00:00.000Z"
}
```

`link_token` 是 10 分钟有效、只能使用一次的敏感凭证。OPP 可通过二维码或用户确认后的手动复制将其传给新设备，不得写入日志或遥测。

### 5.2 新设备证明自己的私钥并加入档案

新设备生成自己的 Ed25519 Key Pair，构造：

```text
OPP_BPH_LINK_DEVICE_V1\n<link_token>\n<new_public_key>\n<device_name>
```

用新设备私钥签名，然后请求：

```http
POST /api/v1/auth/devices/link
Content-Type: application/json

{
  "link_token": "<43-char-secret>",
  "public_key": "<new-device-public-key>",
  "device_name": "Laptop",
  "signature": "<new-device-signature>"
}
```

成功返回新设备自己的 Session。响应中的 `user.id` 必须与旧设备一致，`device.id` 必须不同。使用成功后 link token 立即失效；失败时不要覆盖旧设备的本地身份。

## 6. 查看和管理设备

```http
GET /api/v1/auth/me
Authorization: Bearer <access_token>
```

```json
{
  "user": {
    "id": "<user-uuid>",
    "display_name": "Player"
  },
  "current_device_id": "<device-uuid>",
  "devices": [
    {
      "id": "<device-uuid>",
      "device_name": "Desktop PC",
      "public_key": "<base64url>",
      "created_at": "2026-08-17T12:00:00.000Z",
      "last_seen_at": "2026-08-17T12:00:00.000Z",
      "revoked_at": null
    }
  ]
}
```

撤销其他设备：

```http
DELETE /api/v1/auth/devices/:device_id
Authorization: Bearer <access_token>
```

成功返回 `204`，目标设备的全部 Session 立即失效。服务端拒绝当前设备撤销自身并返回 `CANNOT_REVOKE_CURRENT_DEVICE`；当前设备只需 logout。OPP 的设备管理界面应对当前设备隐藏或禁用“撤销”按钮。

## 7. 客户端启动状态机

```text
没有本地 Key Pair
  → 显示“创建新档案”或“链接已有档案”
  → 创建新档案：Handshake
  → 链接已有档案：接收 link token，执行 Link Device

有 Key Pair + 未过期 Session
  → GET /auth/me
  → 200：进入已登录状态
  → INVALID_SESSION：Challenge 登录

有 Key Pair + 无 Session / Session 过期
  → Challenge 登录
  → AUTH_FAILED：设备未登记或已撤销，显示恢复/重新链接界面
```

## 8. OPP 必须处理的认证错误

| Code | 客户端行为 |
|---|---|
| `INVALID_SIGNATURE` | 检查签名消息字节和本地 Key Pair；不要自动重试死循环 |
| `DEVICE_REGISTERED` | 首次握手改走 Challenge 登录 |
| `AUTH_FAILED` | 当前公钥未登记或设备已撤销 |
| `INVALID_CHALLENGE` | 丢弃旧 Challenge，重新申请一次 |
| `INVALID_SESSION` | 清除 Session token，保留 Key Pair，重新 Challenge 登录 |
| `INVALID_DEVICE_LINK` | 链接凭证过期/已使用，要求旧设备重新生成 |
| `CANNOT_REVOKE_CURRENT_DEVICE` | 禁止撤销当前设备，改用 logout |
| `DEVICE_NOT_FOUND` | 刷新设备列表 |

任何 `5xx` 或网络超时都不应删除 Key Pair、用户 ID 或设备 ID。生产环境只允许 HTTPS。

当前 MVP 没有中心化账号密码或人工找回流程。如果所有已登记设备及私钥同时丢失，原档案无法恢复；OPP 应提醒用户在更换或清理唯一设备前，先链接至少一台新设备。已撤销设备的旧公钥不能重新加入，重新链接时必须生成新的 Key Pair。

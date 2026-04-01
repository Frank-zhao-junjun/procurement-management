# 飞书绑定与身份识别 - 设计决策

## 1. 飞书绑定 Schema 不一致

### 问题

Drizzle Schema (`schema.ts`) 与实现 (`feishu-binding.ts`) 字段不匹配：

| Drizzle Schema | 实现代码 | 说明 |
|----------------|----------|------|
| `feishu_open_id` | `feishu_user_id` | 字段名不一致 |
| `feishu_app_id` | - | Schema 有，实现未用 |
| `agent_id` | - | Schema 有，实现未用 |
| `role` | `entry` | 含义相似，字段名不同 |
| - | `feishu_union_id` | 实现有，Schema 无 |
| - | `is_active` | 实现有，Schema 无 |

### 建议方案

**方案 A**: 统一以 Supabase 为准，修改 Drizzle Schema 与实现对齐

```typescript
// feishu_bindings 表结构（建议）
feishu_user_id: varchar      // 飞书用户 ID
feishu_open_id: varchar      // 飞书 Open ID
feishu_union_id: varchar     // 飞书 Union ID
entry: varchar               // 入口类型：requester/manager/buyer
is_active: boolean            // 是否激活
created_by: varchar          // 创建人
created_at: timestamp
updated_at: timestamp
```

**方案 B**: 移除 Drizzle Schema，仅使用 Supabase Client

---

## 2. 飞书绑定 API 认证

### 问题

当前 `/api/feishu-bindings` 无认证，任何人可创建绑定，存在越权风险。

### 建议方案

**方案 A**: 飞书事件回调认证（推荐）

```bash
# 飞书事件订阅 → 验证签名 → 自动绑定
POST /api/feishu-bindings/event
Headers: X-Feishu-Signature
Body: { schema: "2.0", header: {...}, event: {...} }
```

**方案 B**: 管理员白名单

```bash
# 仅白名单用户可绑定
POST /api/feishu-bindings
Headers: X-Admin-Token
Body: { feishuUserId, entry, adminCode }
```

**方案 C**: 飞书 OAuth 跳转绑定

```bash
# 1. 前端跳转飞书授权
GET /api/feishu-bindings/auth?redirect_uri=xxx&entry=requester

# 2. 飞书回调
GET /api/feishu-bindings/callback?code=xxx&state=xxx
```

---

## 3. 身份识别安全

### 问题

当前 `X-Actor`/`X-Role` 完全由客户端控制，可伪造。

### 建议方案

**方案 A**: 飞书 Access Token 验证（推荐）

```typescript
// 中间件验证飞书 Access Token
async function verifyFeishuIdentity(request: Request) {
  const feishuToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!feishuToken) return null;
  
  // 调用飞书 API 验证 token
  const userInfo = await getFeishuUserInfo(feishuToken);
  return {
    actor: userInfo.open_id,
    role: await getRoleFromBinding(userInfo.open_id),
  };
}
```

**方案 B**: JWT Token（需后端签发）

```typescript
// 登录后签发 JWT
const token = jwt.sign({ actor, role }, SECRET, { expiresIn: '24h' });

// 请求时验证
const payload = jwt.verify(token, SECRET);
```

**方案 C**: 保持现状（仅适用内部信任网络）

- Agent 之间内网调用
- 依赖网络层隔离
- 明确文档标注安全假设

---

## 决策记录

请在以下选项中选择或自定义方案：

| 问题 | 选择 | 备注 |
|------|------|------|
| Schema 不一致 | [ ] 方案A [ ] 方案B | |
| 绑定 API 认证 | [ ] 方案A [ ] 方案B [ ] 方案C | |
| 身份识别 | [ ] 方案A [ ] 方案B [ ] 方案C | |

---

## TODO

- [ ] 确认飞书绑定表结构
- [ ] 确定绑定 API 认证方案
- [ ] 确定身份识别方案
- [ ] 实施选定的方案
- [ ] 更新差距清单状态

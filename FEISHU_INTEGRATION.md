# 飞书 Bot 集成分析

## 问题分析

**飞书 Bot 无法主动联系用户**的根本原因是：**当前采购系统没有实现飞书 Bot 的集成**。

### 当前系统架构

```
┌─────────────────┐         Webhook POST          ┌─────────────────┐
│   采购系统      │ ─────────────────────────────▶ │   Agent 服务     │
│                 │                                │   (外部)         │
└─────────────────┘                                └─────────────────┘
        │                                                    │
        │ 只负责推送通知到 Webhook URL                         │
        │ 不负责消息送达用户                                    │
        ▼                                                    ▼
   事件驱动架构                                          需要 Agent 自己
   (被动通知)                                           处理消息接收
```

### 飞书 Bot 无法主动联系用户的原因

| 问题 | 说明 |
|------|------|
| **1. 缺少飞书 SDK 集成** | 系统没有接入飞书开放平台的 SDK，无法调用发送消息 API |
| **2. 缺少用户标识映射** | `agentId`（如 `buyer-agent`）没有映射到飞书 `open_id`，无法定位用户 |
| **3. 缺少消息发送机制** | Webhook 只是通知外部服务，不是直接发消息给用户 |
| **4. Bot 权限未配置** | 飞书应用需要开通「发送消息到用户」权限 |
| **5. 缺少会话管理** | 没有维护用户与 Bot 之间的会话状态 |

---

## 解决方案

### 方案一：集成飞书 SDK（推荐）

**步骤**：

1. **创建飞书应用**
   - 在飞书开放平台创建企业自建应用
   - 配置应用权限（`im:message:send_as_bot` 等）

2. **安装飞书 SDK**
   ```bash
   pnpm add @larksuiteoapi/node-sdk
   ```

3. **实现消息发送服务**
   ```typescript
   // src/lib/feishu.ts
   import lark from '@larksuiteoapi/node-sdk';

   const client = new lark.Client({
     appId: process.env.FEISHU_APP_ID,
     appSecret: process.env.FEISHU_APP_SECRET,
   });

   /**
    * 发送消息给飞书用户
    */
   export async function sendMessageToUser(openId: string, message: string) {
     return client.im.message.create({
       params: { receive_id_type: 'open_id' },
       data: {
         receive_id: openId,
         msg_type: 'text',
         content: JSON.stringify({ text: message }),
       },
     });
   }
   ```

4. **维护 agentId 到 openId 的映射**
   - 创建 `agent_feishu_mapping` 表
   - 在 Agent 注册时录入对应的飞书 open_id

5. **在 Webhook 触发时发送消息**
   - 修改事件通知逻辑，查询用户映射
   - 调用飞书 SDK 发送消息

### 方案二：使用飞书机器人 Webhook

**步骤**：

1. **创建群机器人**
   - 在飞书群中添加「群机器人」
   - 获取 Webhook 地址

2. **在事件触发时发送消息**
   ```typescript
   // src/lib/feishu-group.ts
   export async function sendToGroup(webhook: string, message: string) {
     await fetch(webhook, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         msg_type: 'text',
         content: { text: message },
       }),
     });
   }
   ```

**缺点**：
- 只能发送到群，无法直接发送给个人
- 消息样式受限

### 方案三：使用 Coze 平台的飞书集成

如果采购系统是通过 Coze 平台部署的 Agent，可以：

1. 在 Coze 平台上配置飞书渠道
2. Agent 可以通过 Coze 平台直接发送消息给用户

---

## 推荐方案

**推荐使用方案一（飞书 SDK 集成）**，原因：
- 支持发送消息给个人用户
- 支持富文本、卡片等消息类型
- 支持消息模板
- 可控性高

---

## 待办事项

- [ ] 在飞书开放平台创建应用
- [ ] 安装并配置飞书 SDK
- [ ] 创建 `agent_feishu_mapping` 表
- [ ] 实现消息发送服务
- [ ] 修改 Webhook 逻辑，集成飞书消息发送
- [ ] 测试消息发送功能

---

## 参考资料

- [飞书开放平台 - 发送消息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create)
- [飞书 Node.js SDK](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)

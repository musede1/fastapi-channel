# AI 交接文档 — fastapi-channel 插件 + Skills

本文档面向接手开发的 AI 会话，记录项目的架构、历史决策、踩过的坑和当前状态。读完后应能直接接手开发。

## 一、项目概览

### 1.1 整体架构

```
飞书多维表 → 自动化触发 → Fastify API（Docker 部署，端口 8003）
                              ↕ WebSocket 长连接
                         OpenClaw 插件（fastapi-channel）
                              ↓
                         AI Agent（gpt-5.4）
                              ↓
                         执行 skill → 生成结果
                              ↓
                         write 文件 + exec curl POST → Fastify /submit 路由
                              ↓
                         Fastify 写入飞书多维表
```

### 1.2 三个项目

| 项目 | 路径 | 仓库 | 说明 |
|------|------|------|------|
| fastapi-channel 插件 | `D:\项目\nodejs\plug\fastapi-channel` | github.com/musede1/fastapi-channel | OpenClaw 渠道插件 |
| Fastify API | `D:\项目\fastify_api` | — | 数据调度服务，Docker 部署 |
| Skills | `D:\项目\skills` | — | 三个 AI 技能（keyword/listing/video）|

### 1.3 网络拓扑

- **Fastify** 在用户本地电脑运行（Docker），通过内网穿透暴露为 `http://42.194.187.253:5680`
- **OpenClaw gateway** 在另一台电脑（`C:\Users\Administrator`），未穿透
- OpenClaw 主动 WebSocket 连接到 Fastify（单向发起，解决网络不对称问题）
- nginx 在 Docker 中，转发 `/feishu_api/*` 到 Fastify 的 8003 端口，已配置 WebSocket 支持

## 二、插件架构（fastapi-channel）

### 2.1 入口模式

**必须使用 `defineChannelPluginEntry`**（从 `openclaw/plugin-sdk/core` 导入），这是 OpenClaw 2026.3.28+ 的新版 API。旧版的手动 `{ id, register(api) }` 模式已不适用。

```ts
// index.ts — 正确写法
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
export default defineChannelPluginEntry({
  id: "fastapi",
  plugin: fastApiPlugin,
  setRuntime: setFastApiRuntime,
  // registerFull(api) { ... } // 可选，用于注册工具
});
```

参考：飞书插件源码在 `C:\Users\admin\Desktop\代码\feishu\`，结构完全一致。

### 2.2 SDK 导入路径

OpenClaw 2026.3.28 要求使用子路径导入，不能用顶层 `"openclaw/plugin-sdk"`：

| 符号 | 导入路径 |
|------|---------|
| `ChannelMeta`, `ChannelPlugin`, `OpenClawPluginApi`, `ClawdbotConfig`, `PluginRuntime` | `openclaw/plugin-sdk/core` |
| `createDefaultChannelRuntimeState`, `buildBaseChannelStatusSummary` | `openclaw/plugin-sdk/status-helpers` |
| `DEFAULT_ACCOUNT_ID` | `openclaw/plugin-sdk/account-id` |
| `createReplyPrefixContext` | `openclaw/plugin-sdk/channel-runtime` |

### 2.3 文件说明

```
index.ts              — 插件入口，defineChannelPluginEntry
src/
├── channel.ts        — ChannelPlugin 实现（meta/config/outbound/gateway）
├── bot.ts            — 消息处理：dispatch 到 agent，deliver 回调
├── account.ts        — 配置解析（wsUrl、dmPolicy 等）
├── config-schema.ts  — Zod schema 定义
├── types.ts          — TypeScript 类型
├── runtime.ts        — PluginRuntime 存储（get/set）
├── ws-client.ts      — WebSocket 客户端（自动重连 + 心跳）
├── ws-send.ts        — WS 客户端引用存储
├── task-map.ts       — task_id ↔ to 映射（outbound.sendText 用）
├── client.ts         — HTTP 文件下载工具（保留，暂未使用）
└── tools.ts          — 工具注册代码（保留但未启用，见踩坑记录）
```

### 2.4 WebSocket 通讯协议

```json
// Fastify → OpenClaw（任务，通过 WS）
{"type": "task", "task_id": "uuid", "content": "提示词", "user_id": "ad_keyword"}

// OpenClaw → Fastify（deliver 回调结果，通过 WS）
{"type": "result", "task_id": "uuid", "status": "completed", "content": "AI回复文本"}
```

**重要**：当前 ad_keyword/ad_listing/ad_video 三个任务**不依赖 WS 返回结果**，而是通过 exec + curl POST 到 Fastify 的 `/feishu_api/openclaw/submit` 路由。WS 的 deliver 回调仍然会触发，但 Fastify 侧用独立的 `httpWaiters` 只等待 HTTP 提交。

### 2.5 Session 隔离

每个任务使用唯一 session key：`agent:{agentId}:fastapi:direct:{task_id}`

这是在 `bot.ts` 里手动覆盖 `resolveAgentRoute` 返回的 session key 实现的，因为默认路由总是返回 `agent:main:main`。

OpenClaw 配置里 `session.dmScope` 已设为 `per-channel-peer`。

## 三、Skills（AI 技能）

### 3.1 三个技能

| 技能 | 路径 | 用途 | 输出格式 |
|------|------|------|---------|
| amazon-keyword-builder | `D:\项目\skills\amazon-keyword-builder` | 广告关键词生成 | JSON（sheet1 + sheet2）|
| amazon-listing-writer | `D:\项目\skills\amazon-listing-writer` | Listing 文案撰写 | JSON（title/bullets/search_terms/description）|
| amazon-main-video | `D:\项目\skills\amazon-main-video` | 视频提示词生成 | JSON |

### 3.2 结果提交方式（统一）

所有技能完成后通过 **write 文件 + exec curl** 提交，不直接输出文本：

```
1. write 工具 → /tmp/result_{task_id}.json
2. exec 工具 → curl -s -X POST http://42.194.187.253:5680/feishu_api/openclaw/submit -H "Content-Type: application/json" -d @/tmp/result_{task_id}.json
```

**为什么用 write + curl 而不是直接 curl -d？** Windows PowerShell 下 curl 传中文 JSON 会乱码。先写文件再 `curl -d @文件` 解决编码问题。

**为什么不用 web_fetch？** OpenClaw 的 `web_fetch` 内置工具只支持 GET，不支持 POST body。

### 3.3 TOON 格式已废弃

所有技能的输出格式已从 TOON 文本改为 JSON。已清理的内容：
- 删除了 `references/toon-format.md`（keyword-builder 和 listing-writer）
- 删除了 `description-rules.md` 中的 TOON 特殊要求章节
- `coverage_checker.py` 升级到 V2.0，`load_listing` 改为解析 JSON，删除 `check_toon_format`
- SKILL.md 中所有 TOON 引用已清除

## 四、踩过的坑（重要）

### 4.1 插件工具注册不生效

**现象**：`api.registerTool` 调用成功（日志确认），但 AI 看不到工具。
**原因**：未找到根本原因。怀疑与 `tools.profile: "coding"` 的白名单机制有关，但飞书工具也不在 allow 列表却能用。改名为 `fastapi_` 前缀、加 `tools.allow` 配置均无效。
**当前方案**：放弃工具注册，改用 exec + curl POST 提交结果。`src/tools.ts` 保留但 `index.ts` 未引用。
**如果要重新尝试**：建议在 OpenClaw 社区或源码中确认插件工具注入 AI context 的具体机制。

### 4.2 deliver 回调截断内容

**现象**：AI 回复较长时，Fastify 只收到部分内容。
**原因**：`outbound.textChunkLimit` 默认 4000，OpenClaw 分块调用 deliver。加上 deliver 可能被调用多次（AI 多段回复），第一个 WS result 就 resolve 了 waitForResult。
**修复**：
- `textChunkLimit` 改为 100000
- deliver 回调累积文本，只在 `info.kind === "final"` 时发送
- 但最终因改为 HTTP 提交方案，此问题已绕过

### 4.3 OpenClaw SDK 升级（2026.3.8 → 2026.3.28）

**现象**：`createDefaultChannelRuntimeState is not a function`。
**原因**：新版 SDK 废弃了 `"openclaw/plugin-sdk"` 顶层导入，改为子路径导入。
**修复**：所有 import 改为 `/core`、`/status-helpers`、`/account-id`、`/channel-runtime` 等子路径。同时 `index.ts` 从手动 `{ register(api) }` 改为 `defineChannelPluginEntry`。

### 4.4 Session 始终为 agent:main:main

**现象**：所有任务共享同一个 session，AI 有上下文干扰。
**原因**：`resolveAgentRoute` 对 fastapi channel 总是返回相同的 session key。
**修复**：在 `bot.ts` 里手动构造 `sessionKey = agent:${route.agentId}:fastapi:direct:${payload.task_id}`，覆盖 route 返回的值。

### 4.5 WS 60 秒断连

**现象**：nginx 默认 60 秒无数据断开 WebSocket。
**修复**：
- nginx 加 `proxy_read_timeout 3600s; proxy_send_timeout 3600s;`
- 插件 ws-client.ts 加 30 秒 ping 心跳

### 4.6 web_fetch 只支持 GET

**现象**：让 AI 用 `web_fetch` POST JSON，实际发出的是 GET 请求，返回 404。
**确认**：通过 TUI 测试确认 web_fetch 不支持 POST body。
**方案**：改用 `exec` 工具执行 curl 命令。

### 4.7 curl 中文乱码

**现象**：`curl -d '{"中文":...}'` 在 Windows 下结果变成问号。
**修复**：先用 `write` 工具写 JSON 到 /tmp 文件，再 `curl -d @文件` 发送。

## 五、OpenClaw 配置要点

配置文件：`C:\Users\Administrator\.openclaw\openclaw.json`

关键配置：
```json
{
  "tools": { "profile": "coding" },
  "session": { "dmScope": "per-channel-peer" },
  "channels": {
    "fastapi": {
      "enabled": true,
      "wsUrl": "ws://42.194.187.253:5680/feishu_api/openclaw/ws"
    }
  },
  "plugins": {
    "allow": ["feishu", "fastapi"],
    "load": {
      "paths": ["...extensions/feishu", "...extensions/fastapi"]
    }
  }
}
```

插件部署路径：`C:\Users\Administrator\.openclaw\extensions\fastapi\`
Skills 部署路径：`C:\Users\Administrator\.openclaw\workspace\skills\`（但日志显示路径解析有 bug，见 `Skipping skill path that resolves outside its configured root`）

## 六、Fastify 侧对应代码

与本插件对接的 Fastify 代码在 `D:\项目\fastify_api\`：

| 文件 | 说明 |
|------|------|
| `src/lib/openclawWs.ts` | WS 连接管理，wsWaiters 和 httpWaiters 分离 |
| `src/lib/openclawStore.ts` | 结果内存存储 |
| `src/handlers/openclawSubmit.ts` | POST /feishu_api/openclaw/submit，接收 AI curl 提交 |
| `src/handlers/openclawAsk.ts` | 通用对话接口 + 结果查询 |
| `src/services/adListing.ts` | 三个任务的核心逻辑（prompt 构建 + waitForHttpResult + 飞书回写）|
| `src/routes/webhook.ts` | 路由注册 |

## 七、待改进项

1. **插件工具注册**：如果 OpenClaw 后续版本修复了 tools profile 的限制，可以恢复 `tools.ts` 的注册，替代 exec + curl 方案
2. **多 OpenClaw 实例**：当前 Fastify WS 只支持一个客户端连接，第二个会覆盖第一个
3. **skill 路径 bug**：`Skipping skill path that resolves outside its configured root` 需要排查
4. **coverage_checker.py**：已改为 JSON 输入（V2.0），但脚本内其他功能（品牌词检测、长度检测等）未做回归测试
5. **URL 硬编码**：`42.194.187.253:5680` 分散在提示词和 replaceInternalUrl 中，应提取为配置项

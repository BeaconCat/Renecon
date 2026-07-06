# Renecon

> **Rene**gade + Bea**con** — 基于 NapCatQQ 的 QQ 群消息侦察与反馈汇总机器人。

Renecon 定向监听指定 QQ 群，将消息实时归档入库，按可配置的时间间隔把窗口内的消息（含图片）
喂给大模型，抽取结构化反馈条目或生成 Markdown 汇总，再推送到飞书机器人。全部通过一个简洁的
WebGUI 配置，开箱即用。

典型用途：在产品交流群里自动盯梢用户对某类产品的反馈 / bug / 建议，定时汇总到飞书。

---

## 功能特性

- **定向监听**：从 NapCat 拉取群列表，勾选要监听的群，仅归档选中群的消息
- **消息池**：SQLite 持久化，支持关键词 / 发言人 / 群多维筛选、分页、删除、多选删除
- **图片留存**：入库即下载群图片到本地，规避 QQ 图片链接鉴权与过期；GUI 缩略图 + 大图预览
- **定时汇总管线**：每 N 分钟（可配）处理一个时间窗口，重启后从断点续跑，宕机期间消息不漏
- **两种输出模式**
  - **结构化 JSON**：字段结构在 GUI 完全可自定义（key / 类型 / 枚举 / 必填），带 zod 校验 + 失败自动重试
  - **Markdown 汇总**：自由生成汇总报告
- **多 LLM 提供方**：OpenAI 兼容接口 / Anthropic Claude / 小米 MiMo（含深度思考开关），GUI 随时切换，可拉取模型列表
- **视觉理解（多模态）**：可选把窗口内群图片一并发给多模态模型分析
- **飞书推送**：自定义机器人 Webhook（支持签名校验），自动把 Markdown 转成飞书卡片实际支持的格式（标题 / 引用 / 表格 / 分割线降级适配）
- **WebGUI**：深/浅双主题、黑白主色 + 红黄蓝荧光强调、完整 i18n 架构（默认中文）、离线 SVG 图标、流畅动画，无 emoji、无 CDN 依赖

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 20+ · Express · better-sqlite3 · ws（OneBot 11 正向 WebSocket）· zod |
| 前端 | Vue 3 · Vite 7 · Pinia · vue-router · vue-i18n |
| 包管理 | pnpm（workspace monorepo） |

## 目录结构

```
Renecon/
├── backend/                # 后端服务
│   └── src/
│       ├── index.js        # 入口：装配 config / db / napcat / scheduler / api
│       ├── config/         # JSON 配置存储 + 变更订阅（热生效）
│       ├── db/             # SQLite：消息池 / 汇总记录 / 运行状态
│       ├── napcat/         # NapCat 正向 WS 客户端（收群消息 + 调 OneBot API）
│       ├── media/          # 图片本地下载与读取
│       ├── llm/            # openai / claude / mimo 适配器 + 结构化抽取（校验重试）
│       ├── feishu/         # 飞书 webhook 推送 + markdown 适配
│       ├── pipeline/       # 调度器 + 窗口汇总 runner
│       ├── api/            # REST API + 前端静态托管
│       └── util/           # 日志
├── frontend/               # WebGUI
│   └── src/
│       ├── views/          # 仪表盘 / 群配置 / LLM / 飞书 / 汇总任务 / 消息池 / 汇总记录 / 日志 / 设置
│       ├── components/     # 离线 SVG 图标等
│       ├── store/          # Pinia：配置、UI（主题 / toast / 模态框）
│       ├── i18n/           # 语言字典（zh-CN，预留扩展）
│       └── styles/         # 主题与动画
├── config.example.json     # 配置结构示例
└── pnpm-workspace.yaml
```

## 快速开始

### 1. 环境

- Node.js ≥ 20
- pnpm ≥ 9
- 一个已运行的 [NapCatQQ](https://napneko.github.io/)（4.x）

### 2. 安装

```bash
pnpm install
# better-sqlite3 为原生模块，如未自动编译：
pnpm rebuild -r better-sqlite3
```

### 3. 配置 NapCat 正向 WebSocket

在 NapCat WebUI 的「网络配置」新建 **WebSocket 服务器**（正向），
host `127.0.0.1`、port `3001`、消息格式 `array`，启用。如设了 access token，稍后在 Renecon 群配置里一并填写。

### 4. 运行

```bash
# 开发（前后端同时起）
pnpm dev
#   后端 http://127.0.0.1:8787
#   前端 http://127.0.0.1:5178  （/api 代理到后端）

# 生产（后端同端口托管 GUI + API）
pnpm build
pnpm start        # http://127.0.0.1:8787
```

### 5. 在 WebGUI 里配置

1. **群配置** — 从 NapCat 拉取群列表，勾选要监听的群
2. **LLM 配置** — 选提供方、填密钥与模型（可「获取列表」），点「测试连接」
3. **飞书机器人** — 填 Webhook（及可选签名密钥），点「测试连接」
4. **汇总任务** — 设间隔、输出模式、（结构化模式）字段结构、提示词、卡片标题，启用定时汇总
5. **仪表盘 / 消息池 / 汇总记录 / 运行日志** — 查看运行状态与历史

## 数据与隐私

- 所有运行时数据在 `backend/data/`：
  - `config.json` — 配置（含密钥 / token，**已被 .gitignore 忽略，切勿提交**）
  - `renecon.db` — 消息池与汇总记录
  - `images/` — 下载的群图片
- Renecon 默认监听 `127.0.0.1`，为本地内部工具。若要暴露公网，请自行加鉴权（当前 `/api` 无认证）。

## 兼容性说明

- NapCat 对接协议：[OneBot 11](https://napneko.github.io/)，正向 WebSocket
- 飞书 `markdown` 卡片元素不支持标题 / 引用 / 表格 / 分割线，Renecon 推送前自动降级适配为受支持的写法

## 许可证

[MIT](./LICENSE)

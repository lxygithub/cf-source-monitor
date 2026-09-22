# CF 资源余量监控

监控 Cloudflare 免费资源配额使用情况：Workers 请求量、R2 存储与操作数、D1 读写行数等，
接近限额时分级告警提醒，避免免费额度意外超限导致服务中断。

> 🚀 **部署指南**：完整的自托管部署文档（VPS / Docker / Vercel、MySQL 配置、HTTPS 与安全加固）见 [DEPLOY.md](./DEPLOY.md)

## 功能特性

- **多账号支持**：添加多个 Cloudflare 账号分别监控，支持「全部账号」聚合视图与单账号视图切换
- **自动采集**：通过 Cloudflare GraphQL Analytics / REST API 自动获取用量
  - Workers 请求次数（每日 10 万）
  - R2 存储用量（10 GB）· R2 Class A（100 万次/月）· Class B（1000 万次/月）
  - D1 读取行数（500 万行/日）· 写入行数（10 万行/日）· 存储总量（5 GB）
- **自定义指标**：API 无法自动采集的资源（KV 读写、Pages 构建次数等）可手动记录，按账号隔离
- **分级告警**：≥60% 接近限额（黄色提醒）· ≥85% 额度紧张（红色告警）· ≥100% 已超限
- **趋势快照**：每日快照持久化到数据库，近 7 日用量柱状趋势图
- **配额可调**：升级付费套餐后可在界面直接修改各指标配额上限
- **演示模式**：一键生成双演示账号模拟数据，无需真实账号即可体验完整功能
- **自动刷新**：60 秒定时刷新，可手动关闭；支持当前视图（单账号 / 全部）定向刷新

## 架构说明

标准三层架构，**浏览器前端不直接连接数据库**，所有数据库访问都在服务端完成：

```
┌─────────────────────────────────────────────┐
│ 浏览器前端（React）                           │
│ 只发起 fetch('/api/...') 同源相对路径请求      │
└──────────────────┬──────────────────────────┘
                   │ HTTP (JSON)
┌──────────────────▼──────────────────────────┐
│ Next.js 服务端（API Routes）                  │
│ Prisma Client 仅在此运行                      │
│ DATABASE_URL / API Token 仅在此可读           │
└──────────────────┬──────────────────────────┘
                   │ Prisma
┌──────────────────▼──────────────────────────┐
│ 数据库：SQLite（默认）/ MySQL / PostgreSQL    │
└─────────────────────────────────────────────┘
```

- `DATABASE_URL` 未使用 `NEXT_PUBLIC_` 前缀，**不会**被打包进浏览器 JS
- 前端构建产物中不含 Prisma 代码与数据库凭据
- Cloudflare API Token 只存在数据库中，仅在服务端调用 Cloudflare API 时使用，接口响应不回传

## 快速开始（SQLite，零配置）

```bash
# 0. 要求 Node.js 20+ 或 Bun 1.1+

# 1. 安装依赖
bun install        # 或 npm install

# 2. 配置数据库连接
cp .env.example .env   # 默认即为 SQLite

# 3. 推送数据表结构
bun run db:push    # 或 npx prisma db push

# 4a. 开发模式
bun run dev        # http://localhost:3000

# 4b. 生产模式
bun run build
bun run start      # 或: node .next/standalone/server.js
```

启动后打开页面，通过右上角「账号管理」填入 Cloudflare **Account ID** 与 **API Token** 即可开始监控；
也可以一键开启演示模式，用模拟数据体验全部功能。

切换到 MySQL 只需两步（`provider` + `DATABASE_URL`），完整步骤与避坑指南见 **[DEPLOY.md](./DEPLOY.md)**。

## API Token 权限说明

创建 Token（My Profile → API Tokens → Create Token）时建议仅授予只读权限：

| 权限 | 用途 |
| --- | --- |
| Account → Account Analytics → Read | Workers / R2 / D1 分析数据 |
| Account → D1 → Read | D1 数据库存储用量 |

Token 仅存储在自建数据库中，不会上传到任何第三方服务。

## 多账号说明

- 每个账号的配额、快照、自定义指标按 Cloudflare Account ID 相互隔离
- 「全部账号」视图按账号分组展示，概览统计与告警横幅跨账号聚合
- 演示账号（accountId 为 `demo` / `demo-b`）为内置模拟数据，可在账号管理中一键移除，不影响真实账号
- 采集失败时错误信息会带上账号名前缀，方便定位是哪个账号的 Token 或权限问题

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── config/          # 账号配置（列表/添加/编辑/删除 + 测试连接）
│   │   ├── monitor/         # 用量状态与手动/定向刷新
│   │   ├── quotas/          # 配额调整
│   │   ├── custom-metrics/  # 自定义指标 CRUD
│   │   └── demo/            # 演示模式开关
│   └── page.tsx             # 监控仪表盘（单路由）
├── components/monitor/      # 仪表盘组件（卡片/弹窗/趋势图/账号管理）
└── lib/monitor/             # 指标注册表 / Cloudflare 客户端 / 服务层
```

## 技术栈

- **框架**：Next.js 16（App Router，standalone 输出）+ TypeScript + React 19
- **UI**：Tailwind CSS 4 + shadcn/ui + Recharts
- **数据库**：Prisma ORM（SQLite 默认 / MySQL / PostgreSQL 均可切换）
- **数据源**：Cloudflare GraphQL Analytics API + REST API

## 说明

- Cloudflare 免费额度按 **UTC 时间 00:00** 重置，月度额度自然月内累计
- R2 Class A/B 按操作类型分类统计，未收录的操作类型不计入
- 部分指标（如 KV 存储量）Cloudflare 未开放 API，请使用自定义指标手动记录
- 本应用默认**无登录鉴权**，公网部署请务必参考 DEPLOY.md 的「安全加固」章节

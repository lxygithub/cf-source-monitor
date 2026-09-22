# CF 资源余量监控

监控 Cloudflare 免费资源配额使用情况：Workers 请求量、R2 存储与操作数、D1 读写行数等，
接近限额时分级告警提醒，避免免费额度意外超限导致服务中断。

## 功能特性

- **自动采集**：通过 Cloudflare GraphQL Analytics / REST API 自动获取用量
  - Workers 请求次数（每日 10 万）
  - R2 存储用量（10 GB）· R2 Class A（100 万次/月）· Class B（1000 万次/月）
  - D1 读取行数（500 万行/日）· 写入行数（10 万行/日）· 存储总量（5 GB）
- **自定义指标**：API 无法自动采集的资源（KV 读写、Pages 构建次数等）可手动记录
- **分级告警**：≥60% 接近限额（黄色提醒）· ≥85% 额度紧张（红色告警）· ≥100% 已超限
- **趋势快照**：每日快照持久化到 SQLite，近 7 日用量柱状趋势图
- **配额可调**：升级付费套餐后可在界面直接修改各指标配额上限
- **演示模式**：一键生成模拟数据，无需真实账号即可体验完整功能
- **自动刷新**：60 秒定时刷新，可手动关闭

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 配置数据库连接（.env）
DATABASE_URL=file:./db/custom.db

# 3. 推送数据表结构
bun run db:push

# 4. 启动开发服务器
bun run dev
```

访问首页后，点击右上角「设置」填入 Cloudflare **Account ID** 与 **API Token** 即可开始监控。

## API Token 权限说明

创建 Token（My Profile → API Tokens → Create Token）时建议仅授予只读权限：

| 权限 | 用途 |
| --- | --- |
| Account → Account Analytics → Read | Workers / R2 / D1 分析数据 |
| Account → D1 → Read | D1 数据库存储用量 |

Token 仅存储在本地 SQLite 数据库中，不会上传到任何第三方服务。

## 技术栈

- **框架**：Next.js 16（App Router）+ TypeScript
- **UI**：Tailwind CSS 4 + shadcn/ui + Recharts
- **数据库**：Prisma ORM + SQLite（快照 / 配额 / 自定义指标）
- **数据源**：Cloudflare GraphQL Analytics API + REST API

## 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── config/          # 账号配置（GET/PUT/DELETE + 测试连接）
│   │   ├── monitor/         # 用量状态与刷新
│   │   ├── quotas/          # 配额调整
│   │   ├── custom-metrics/  # 自定义指标 CRUD
│   │   └── demo/            # 演示模式
│   └── page.tsx             # 监控仪表盘
├── components/monitor/      # 仪表盘组件（卡片/弹窗/趋势图等）
└── lib/monitor/             # 指标注册表 / Cloudflare 客户端 / 服务层
```

## 说明

- Cloudflare 免费额度按 **UTC 时间 00:00** 重置，月度额度自然月内累计
- R2 Class A/B 按操作类型分类统计，未收录的操作类型不计入
- 部分指标（如 KV 存储量）Cloudflare 未开放 API，请使用自定义指标手动记录

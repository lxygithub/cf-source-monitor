# CF 资源余量监控

监控 Cloudflare 免费资源配额：Workers、Pages Functions、Durable Objects、R2、KV、D1、Vectorize、Workers AI 等，
接近限额时分级告警，避免额度意外超限导致服务中断。

> 🚀 完整自托管部署文档（Docker / VPS / Cloudflare Tunnel / MySQL / HTTPS / 安全加固）见 [DEPLOY.md](./DEPLOY.md)

## 功能特性

- **多账号 + 视图切换**：顶部下拉切换「全部账号」或单个账号，可点星标设为默认视图，本机记忆上次选择
- **27 项内置指标**：见下方清单，全部通过 Cloudflare GraphQL Analytics / REST 自动采集
- **拆分视图**：KV 按 namespace、D1 按数据库、Pages Functions 按项目分别统计。卡片两行显示：第一行资源名，第二行指标名 + 资源 ID
- **卡片收藏**：星标收藏后置顶到账号区块最上方的「收藏」组，服务端持久化（换设备同样生效）
- **分类分组**：Workers 与计算 / 存储 / 数据库 / Workers AI / 平台与其他，每组带指标数与告警计数
- **分级告警**：≥60% 接近限额（黄）· ≥85% 额度紧张（红）· ≥100% 已超限
- **趋势折线图**：近 7 日用量折线（卡片迷你图 + 点击卡片看大图），按 UTC 日聚合
- **自定义指标**：API 未开放的数据（如 Pages 构建次数）可手动记录，按账号隔离
- **配额可调**：任意指标阈值可在界面修改，默认值参考免费套餐
- **演示模式**：一键生成双演示账号模拟数据，无需真实账号即可体验
- **自动刷新**：60 秒定时刷新，可关闭；支持按当前视图定向刷新

## 指标清单（27 项内置指标）

| 指标 ID | 名称 | 单位 | 周期 | 默认阈值 | 分类 |
| --- | --- | --- | --- | --- | --- |
| `workers_requests` | Workers 请求次数 | 次 | 每日 | 100 000 | workers |
| `workers_subrequests` | Workers 子请求数 | 次 | 每日 | 1 000 000 | workers |
| `workers_cache_requests` | Workers 缓存命中请求 | 次 | 每日 | 100 000 | workers |
| `workers_builds_minutes` | Workers 构建时长 | 分钟 | 每月 | 3 000 | workers |
| `pages_functions_requests` | Pages Functions 请求 | 次 | 每日 | 100 000 | workers |
| `pages_functions_error_rate` | Pages Functions 错误率 | % | 每日 | 2 | workers |
| `pages_functions_error_rate_7d` | Pages Functions 错误率（近 7 日滚动） | % | 每日 | 2 | workers |
| `durable_objects_requests` | Durable Objects 请求 | 次 | 每日 | 1 000 000 | workers |
| `r2_storage` | R2 存储用量 | GB | 总量 | 10 | storage |
| `r2_class_a` | R2 Class A 操作 | 次 | 每月 | 1 000 000 | storage |
| `r2_class_b` | R2 Class B 操作 | 次 | 每月 | 10 000 000 | storage |
| `r2_bandwidth_download` | R2 下行流量 | GB | 每月 | 1 000 | storage |
| `r2_bandwidth_upload` | R2 上行流量 | GB | 每月 | 1 000 | storage |
| `kv_reads` | KV 读取次数 | 次 | 每日 | 100 000 | storage |
| `kv_writes` | KV 写入次数 | 次 | 每日 | 1 000 | storage |
| `kv_deletes` | KV 删除次数 | 次 | 每日 | 1 000 | storage |
| `kv_lists` | KV 列举次数 | 次 | 每日 | 1 000 | storage |
| `kv_storage` | KV 存储用量 | GB | 总量 | 1 | storage |
| `d1_rows_read` | D1 读取行数 | 行 | 每日 | 5 000 000 | database |
| `d1_rows_written` | D1 写入行数 | 行 | 每日 | 100 000 | database |
| `d1_storage` | D1 存储用量 | GB | 总量 | 5 | database |
| `vectorize_storage` | Vectorize 存储维度 | 维度 | 总量 | 10 000 000 | database |
| `vectorize_queries` | Vectorize 查询维度 | 维度 | 每月 | 30 000 000 | database |
| `hyperdrive_queries` | Hyperdrive 查询数 | 次 | 每日 | 1 000 000 | database |
| `ai_neurons` | Workers AI Neurons | Neurons | 每日 | 10 000 | ai |
| `images_transformations` | Images 转换次数 | 次 | 每月 | 5 000 | platform |
| `logpush_bytes` | Logpush 流量 | GB | 每月 | 1 000 | platform |

阈值默认值参考 Cloudflare Free 套餐，可在界面逐项修改。R2 带宽、子请求、Hyperdrive、Logpush
等没有硬性免费额度的指标，默认值仅作观测阈值，按需调整。

### 拆分视图

同一份分析数据可按资源拆分，ID 形式为 `<指标>|<作用域>|<资源 ID>`：

| 作用域 | 指标 | ID 示例 |
| --- | --- | --- |
| `ns` KV 命名空间 | KV 读取 / 写入 / 删除 / 列举 | `kv_reads\|ns\|71d7525929c74606b8584743a39c36ca` |
| `db` D1 数据库 | D1 读取 / 写入 / 存储 | `d1_rows_read\|db\|2c238e34-2549-4387-ab4c-368c8c19a78b` |
| `pj` Pages 项目 | Pages 请求 / 错误率 | `pages_functions_error_rate\|pj\|12875515` |

拆分项继承账号级默认阈值（配额本身是账号级共享的，拆分只用于定位用量来源）。

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
│ 定时向 Cloudflare 拉取用量（GraphQL + REST）   │
└──────────────────┬──────────────────────────┘
                   │ Prisma
┌──────────────────▼──────────────────────────┐
│ 数据库：SQLite（默认）/ MySQL                 │
└─────────────────────────────────────────────┘
```

- `DATABASE_URL` 未使用 `NEXT_PUBLIC_` 前缀，**不会**被打包进浏览器 JS
- Cloudflare API Token 只存在于数据库中，仅在服务端调用 Cloudflare API 时使用，接口响应不回传
- 每个账号每次刷新向 Cloudflare 发 3 次请求：主趋势查询（Workers/D1/R2）+ 扩展数据集（KV/Pages/AI/DO 等）+ 本月 R2 操作；D1 存储拿不到时再补 1 次 REST

## 数据与快照

- 快照表 `UsageSnapshot`（`accountId` / `metric` / `used` / `capturedAt`），按 UTC 日聚合
- 写入是「按日幂等」的：同一天重复刷新只更新当天那一条，不会产生重复行
- 日维度指标回填近 7 日历史；月度 / 总量指标每次刷新记一个点，趋势图按天取最后一条
- 分析数据通常滞后几小时：整批数据都还没出当天时用最近可用一天填充；数据集已更新而某项当天无数据则记 0（不沿用昨天的旧值）
- 历史快照不会自动清理，趋势接口只读最近 7 天

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

启动后打开页面，通过右上角「账号」填入 Cloudflare **Account ID** 与 **API Token** 即可开始监控；
也可以一键开启演示模式，用模拟数据体验全部功能。

## API Token 权限说明

按需授予，全部只读：

| 权限 | 是否必需 | 用途 |
| --- | --- | --- |
| `Account` → `Account Analytics` → `Read` | ✅ 必需 | 所有内置指标的 GraphQL 分析数据（Workers / R2 / D1 / KV / Pages / DO / AI 等） |
| `Account` → `D1` → `Read` | 可选 | D1 存储总量，仅在分析数据集取不到时兜底（REST `/accounts/{id}/d1/database`） |
| `Account` → `Workers KV Storage` → `Read` | 可选 | KV namespace 名称（否则拆分卡片显示短 ID） |
| `Account` → `Cloudflare Pages` → `Read` | 可选 | Pages 项目名称（否则拆分卡片显示项目数字 ID） |

两类 Token 都支持：

- **User-owned**（My Profile → API Tokens，无前缀）：用 `/user/tokens/verify` 校验
- **Account-owned**（Account → API Tokens，`cfat_` 前缀）：`/user/tokens/verify` 固定返回 401，程序自动回落到 `/accounts/{id}/tokens/verify`，所以**必须同时填写 Account ID**

自测命令（把 `TOK` / `ACC` 换成实际值）：

```bash
# 校验 Token
curl -sS -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/tokens/verify"

# 取一行 Workers 分析数据（验证 Account Analytics:Read）
curl -sS -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"query":"query Q($a:String!,$s:Date!,$e:Date!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:1,filter:{date_geq:$s,date_leq:$e}){dimensions{date} sum{requests}}}}}","variables":{"a":"'$ACC'","s":"2026-09-01","e":"2026-09-02"}}' \
  https://api.cloudflare.com/client/v4/graphql
```

## 使用方式

- **视图切换**：`账号` 下拉选「全部账号」或单个账号；旁边星标按钮把当前视图设为默认（服务端保存，跨设备生效），本机还会记住上次选择
- **收藏**：卡片右上角星标，收藏后置顶到「收藏」分组，并从原分类移出
- **改阈值**：点卡片上的铅笔图标，按实际套餐填新额度
- **看趋势**：点卡片图表区域，弹窗显示近 7 日折线 + 配额参考线
- **自定义指标**：账号区块底部「添加指标」，手动记录 API 未开放的数据

## 项目结构

```
prisma/
└── schema.prisma            # CfAccount / MetricQuota / UsageSnapshot / CustomMetric / MetricFavorite / AppSetting
src/
├── app/
│   ├── api/
│   │   ├── config/          # 账号配置（列表/添加/编辑/删除 + 测试连接）
│   │   ├── monitor/         # 用量状态与手动/定向刷新
│   │   ├── quotas/          # 配额调整
│   │   ├── custom-metrics/  # 自定义指标 CRUD
│   │   ├── favorites/       # 卡片收藏
│   │   ├── settings/        # 默认视图等应用设置
│   │   └── demo/            # 演示模式开关
│   ├── icon.svg             # favicon
│   └── page.tsx             # 监控仪表盘（单路由）
├── components/monitor/      # 卡片/分类分组/趋势图/账号管理
└── lib/monitor/             # 指标注册表 / Cloudflare 客户端 / 服务层
```

## 技术栈

- **框架**：Next.js 16（App Router，standalone 输出）+ TypeScript + React 19
- **UI**：Tailwind CSS 4 + shadcn/ui + Recharts
- **数据库**：Prisma ORM（SQLite 默认 / MySQL）
- **数据源**：Cloudflare GraphQL Analytics API + REST API

## 已知限制

- **无内建登录鉴权**：公网部署务必在反向代理加 Basic Auth / IP 白名单，见 DEPLOY.md「安全加固」
- **Cloudflare 速率限制**：GraphQL Analytics 约 300 请求 / 5 分钟 / 用户，REST 约 1200 请求 / 5 分钟 / 用户；超限返回 `429`，界面会显示采集失败
- **查询时间窗上限**：单次查询最大约 `4w4d`，且各数据集不同（Images 只允许 `4w2d1h`）。程序用 7 天窗口，月维度自动裁到 27 天
- **`limit` 上限 10000**：GraphQL 单数据集 `limit` 超过 10000 直接报错
- **Pages 的 `__unknown__` 桶**：部分 Pages Functions 请求在分析数据里不带 scriptName，无法归属项目，只能显示「未知项目」
- **跨账号 KV namespace**：REST 只能列出本账号的 namespace，其他账号的 namespace 在拆分视图里只能显示 ID

## 说明

- Cloudflare 免费额度按 **UTC 时间 00:00** 重置，月度额度自然月内累计
- R2 Class A/B 按操作类型分类统计，未收录的操作类型不计入
- 部分指标（如 KV 单键大小、Pages 构建次数）Cloudflare 未开放 API，请使用自定义指标手动记录

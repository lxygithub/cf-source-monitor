# 部署文档

覆盖自托管部署全流程：数据库选型（SQLite / MySQL）、Docker Compose、VPS 裸机、Cloudflare Tunnel 内网接入、
反向代理与 HTTPS、安全加固、备份升级、运维命令与 FAQ。

先明确架构前提，避免常见误解：

```
浏览器 ──HTTP──▶ Next.js 服务端 ──Prisma──▶ 数据库
                    │
                    └──HTTPS──▶ Cloudflare API（只读查询用量）
```

- **前端不直连数据库**：浏览器只发 `/api/*` 同源请求，数据库连接串只存在于服务端 `.env`
- **服务端是唯一数据库客户端**：部署时只需保证跑 Next.js 的机器能访问数据库
- **Cloudflare API 由服务端调用**：需要能访问 `api.cloudflare.com:443`

## 目录

1. [环境要求](#1-环境要求)
2. [数据库配置](#2-数据库配置)
3. [部署方式](#3-部署方式)
   - [方式一：Docker Compose（推荐）](#方式一docker-compose推荐)
   - [方式二：VPS 裸机（Bun/Node + PM2/systemd）](#方式二vps-裸机bunnode--pm2systemd)
   - [方式三：Cloudflare Tunnel + 本机 Nginx（公网推荐）](#方式三cloudflare-tunnel--本机-nginx公网推荐)
   - [方式四：Serverless / Vercel](#方式四serverless--vercel)
4. [反向代理与 HTTPS](#4-反向代理与-https)
5. [安全加固（必读）](#5-安全加固必读)
6. [备份与恢复](#6-备份与恢复)
7. [升级](#7-升级)
8. [运维命令](#8-运维命令)
9. [FAQ](#9-faq)

---

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| 运行时 | Bun 1.1+ 或 Node.js 20+（二选一） |
| 数据库 | SQLite（默认，零配置）/ MySQL 5.6+ |
| 出站网络 | 能访问 `api.cloudflare.com:443`；使用外部数据库时能访问其端口 |
| 内存 | 512 MB 起步 |
| 镜像构建 | 需要能拉取 `oven/bun` 镜像；首次构建约 5–10 分钟（依赖安装 + Next 构建） |

---

## 2. 数据库配置

### 方案 A：SQLite（默认，零配置）

适合单机自用。数据就是单个文件，备份即复制文件。

```bash
cp .env.example .env          # 默认 DATABASE_URL=file:./db/custom.db
bun run db:push               # 建表
```

**路径解析规则**：SQLite 的相对路径按 `prisma/schema.prisma` 所在目录解析。生产环境建议用绝对路径，
避免工作目录变化找不到库文件：

```bash
DATABASE_URL="file:/var/lib/cf-monitor/custom.db"
```

> ⚠️ Docker Compose 用的是 `file:/app/db/custom.db`，并把宿主 `./db` 挂载到容器 `/app/db`。
> 若要在宿主上跑 `bun run db:push` 给容器建库，`.env` 写 `file:../db/custom.db`
> （相对 `prisma/` 解析 ⇒ 仓库根 `db/custom.db`，与挂载路径一致）。

### 方案 B：MySQL

适合云数据库 / 多实例共享。Prisma 官方支持 MySQL 5.6.2+、8.x。

**三步切换：**

**① 建库**（MySQL 5.7 默认字符集是 latin1，不指定 utf8mb4 会导致中文乱码）：

```sql
CREATE DATABASE IF NOT EXISTS cf_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

**② 修改 `prisma/schema.prisma` 的 provider：**

```diff
 datasource db {
-  provider = "sqlite"
+  provider = "mysql"
   url      = env("DATABASE_URL")
 }
```

**③ 配置 `.env` 并建表：**

```bash
DATABASE_URL="mysql://用户名:URL编码后的密码@主机:端口/cf_monitor?connection_limit=10"
bun run db:push
```

#### 连接串特殊字符 URL 编码对照表

| 字符 | 编码 | 字符 | 编码 | 字符 | 编码 |
| --- | --- | --- | --- | --- | --- |
| `#` | `%23` | `[` | `%5B` | `]` | `%5D` |
| `@` | `%40` | `:` | `%3A` | `/` | `%2F` |
| `?` | `%3F` | `&` | `%26` | 空格 | `%20` |

示例：密码 `9s[BAL#h` → `9s%5BBAL%23h`。

#### 连接参数建议

| 参数 | 建议值 | 说明 |
| --- | --- | --- |
| `connection_limit` | 单机 `10`；Serverless `5` | Prisma 连接池大小 |
| `connect_timeout` | `15` | 云数据库公网延迟高时加大 |
| `sslaccept` / `sslcert` | 视云商要求 | 托管 MySQL 强制 TLS 时配置 |

### 连接故障排查（实战六坑）

| # | 坑 | 现象 | 解法 |
| --- | --- | --- | --- |
| 1 | 端口用错 | 控制台写 3306 常是内网端口 | 用公网映射端口；`nc -vz IP 端口` 测连通 |
| 2 | 用户名用错 | `Access denied for user 'root'@'你的IP'` | 用控制台展示的完整用户名（常带随机后缀） |
| 3 | 特殊字符被吞 | shell 里 `-p'密码'` 未加引号，`#` 后被当注释 | 引号包裹；连接串按上表编码 |
| 4 | 认证插件不兼容 | `Authentication plugin 'caching_sha2_password' cannot be loaded` | 升级客户端；Prisma 内置客户端两种插件都支持 |
| 5 | IP 白名单 | 账号是 `user@%` 但云控制台另配白名单 | `curl ifconfig.me` 取出口 IP 加白名单 |
| 6 | 出站受限 | 服务器禁出站非标端口 | `nc -vz` 测；找服务商放行或换标准端口 |

通用顺序：先 `nc -vz` 测 TCP → 再 `mysql -h ... -P ... -u ...` 测认证 → 最后看应用日志。

---

## 3. 部署方式

### 方式一：Docker Compose（推荐）

仓库内置 `Dockerfile`（多阶段构建，runner 为 `oven/bun:1-alpine`）与 `docker-compose.yml`。

```bash
# 1. 拉代码
git clone https://github.com/lxygithub/cf-source-monitor.git
cd cf-source-monitor

# 2. 准备目录与数据库连接串
#    .env 只在宿主跑 db:push 时用到；容器内的 DATABASE_URL 由 compose 注入
printf 'DATABASE_URL="file:../db/custom.db"\n' > .env

# 3. 建库（宿主机需要 bun 或 node）
mkdir -p db
bun install --frozen-lockfile
bun run db:push

# 4. 构建并启动
docker compose up -d --build

# 5. 验证
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/          # 期望 200
curl -sS http://127.0.0.1:3000/api/monitor/status | head -c 200           # 期望 JSON
```

要点：

- **compose 默认挂载** `./db:/app/db`，容器内 `DATABASE_URL=file:/app/db/custom.db`，数据落宿主 `./db/custom.db`
- **换 MySQL**：编辑 `docker-compose.yml`，替换 `DATABASE_URL` 为 MySQL 连接串，并删除 `volumes` 里的 SQLite 挂载；同时把 `prisma/schema.prisma` 的 provider 改成 `mysql`
- **容器访问宿主 MySQL**：主机写 `host.docker.internal`（Docker Desktop）；Linux 需在 compose 加 `extra_hosts: ["host.docker.internal:host-gateway"]`
- **Prisma 引擎**：runner 是 alpine（musl），`prisma/schema.prisma` 里的 `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` 不能删，否则运行时报
  `Prisma Client could not locate the Query Engine for runtime "linux-musl-openssl-3.0.x"`。若把 runner 换成 debian 镜像，改成 `debian-openssl-3.0.x`
- **`public/` 目录**：`package.json` 的 build 脚本会 `cp -r public .next/standalone/`，仓库用 `public/.gitkeep` 占位，别删
- **端口冲突**：改 `ports` 映射即可，例如 `"8080:3000"`

### 方式二：VPS 裸机（Bun/Node + PM2/systemd）

```bash
# 1. 拉代码
git clone https://github.com/lxygithub/cf-source-monitor.git
cd cf-source-monitor

# 2. 安装依赖
bun install                     # 或 npm install

# 3. 配置数据库
cp .env.example .env
vim .env                        # SQLite 直接用；MySQL 按上文切换
bun run db:push

# 4. 构建 + 启动
bun run build
bun run start                   # 或: PORT=3000 node .next/standalone/server.js
```

**PM2 守护：**

```bash
npm i -g pm2
PORT=3000 pm2 start .next/standalone/server.js --name cf-monitor
pm2 save && pm2 startup
```

**systemd 守护：**

```ini
# /etc/systemd/system/cf-monitor.service
[Unit]
Description=CF Resource Monitor
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/cf-source-monitor
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /opt/cf-source-monitor/.next/standalone/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now cf-monitor
```

### 方式三：Cloudflare Tunnel + 本机 Nginx（公网推荐）

源站不开放 80/443，TLS 由 Cloudflare 边缘终结，cloudflared 回源到本机 Nginx，再由 Nginx 转发到容器。
本项目的线上部署即此方案：

```
浏览器 ──HTTPS──▶ Cloudflare 边缘 ──Tunnel──▶ cloudflared ──▶ 127.0.0.1:18082 (Nginx) ──▶ 127.0.0.1:3000 (容器)
```

**① cloudflared**：配置 tunnel（`/etc/cloudflared/config.yml`，token 或 cert 认证），在 Cloudflare 控制台
Zero Trust → Networks → Tunnels → Public Hostnames 添加：`cf-monitor.example.com` → `HTTP` → `127.0.0.1:18082`。
DNS 记录由控制台自动创建（Proxied）。

> 若 tunnel 是「控制台托管」模式（config.yml 里没有 `ingress` 段），公网入口必须在控制台改，本地文件改了不生效。

**② Nginx 站点**（`/etc/nginx/sites-available/cf-monitor.conf`）：

```nginx
# 注意：同一 http 作用域内 map 名不能重复，这里用独立名字
map $http_upgrade $cf_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 127.0.0.1:18082;
    server_name cf-monitor.example.com;
    server_tokens off;
    client_max_body_size 2m;

    # 应用本身无登录鉴权，公网入口必须加一层
    auth_basic "CF Monitor";
    auth_basic_user_file /etc/nginx/.htpasswd-cf-monitor;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $cf_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_send_timeout 120s;
        # 手动刷新会并发查询 Cloudflare，读超时给足
        proxy_read_timeout 120s;
    }
}
```

```bash
# Basic Auth 账号（htpasswd 未安装时用 openssl）
sudo apt-get install -y apache2-utils   # 或：openssl passwd -apr1 '你的密码'
htpasswd -c /etc/nginx/.htpasswd-cf-monitor admin

sudo ln -sf /etc/nginx/sites-available/cf-monitor.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 验证：无凭据 401，带凭据 200
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: cf-monitor.example.com' http://127.0.0.1:18082/
curl -sS -o /dev/null -w '%{http_code}\n' -u admin:密码 -H 'Host: cf-monitor.example.com' http://127.0.0.1:18082/
```

### 方式四：Serverless / Vercel

SQLite 基于本地文件，**Serverless 不可用**，必须用外部 MySQL：

1. 切换 provider 并配置 `DATABASE_URL`（Vercel 项目环境变量里配置）
2. 连接串务必加 `?connection_limit=5`，避免高并发打爆云数据库连接数
3. 本地执行 `bun run db:push` 建表后再部署

---

## 4. 反向代理与 HTTPS

**Caddy（自动 HTTPS，最简单）：**

```caddyfile
monitor.example.com {
    basic_auth {
        admin $2a$14$...      # caddy hash-password 生成
    }
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx（443 直连）：**

```nginx
server {
    listen 443 ssl;
    server_name monitor.example.com;
    ssl_certificate     /etc/ssl/certs/monitor.pem;
    ssl_certificate_key /etc/ssl/private/monitor.key;

    auth_basic "CF Monitor";
    auth_basic_user_file /etc/nginx/.htpasswd-cf-monitor;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Cloudflare Access（不想用 Basic Auth 时）**：Zero Trust → Access → Applications 给该域名加策略，
只允许指定邮箱 / 服务令牌访问，源站仍然只监听内网。

---

## 5. 安全加固（必读）

本应用**没有内建登录鉴权**——任何能打开页面的人都能看用量面板、修改配额、调用配置接口。
公网部署至少做一项：

| 措施 | 做法 |
| --- | --- |
| 反向代理 Basic Auth（推荐） | 见方式三的 Nginx 片段；Caddy 用 `basic_auth` |
| Cloudflare Access | Zero Trust 里给域名加策略，限定邮箱 / IP |
| IP 白名单 | 云防火墙 / 安全组只放行自己的出口 IP |
| 内网 / VPN 部署 | 不暴露公网，走 Tailscale / WireGuard |

其他要点：

- **Cloudflare Token 只给只读权限**（见 README 权限表），泄露也改不动账号资源；建议同时设过期时间
- **Token 已泄露过就轮换**：控制台编辑 token → Roll，或删除重建，然后在面板「账号 → 编辑」贴新的
- **数据库文件收权限**（SQLite 里存着明文 Token）：

  ```bash
  chmod 700 /path/to/cf-source-monitor/db
  chmod 600 /path/to/cf-source-monitor/db/custom.db
  ```

  容器内进程 uid 需与宿主文件属主一致（官方 `oven/bun` 镜像的 `bun` 用户是 uid 1000），否则写库会失败
- **数据库不要暴露公网**；云数据库用强密码并限定白名单
- **备份文件里含 Token**，别同步到公有云或提交进 Git

---

## 6. 备份与恢复

**SQLite：**

```bash
# 热备（推荐，不停服）
sqlite3 /path/to/custom.db ".backup '/backup/custom-$(date +%F).db'"
# 冷备：停服后复制文件
docker compose stop cf-monitor && cp db/custom.db /backup/ && docker compose start cf-monitor
# 恢复：停服 → 用备份覆盖 → 启动
```

**MySQL：**

```bash
mysqldump -h <host> -P <port> -u <user> -p cf_monitor > cf_monitor-$(date +%F).sql
mysql -h <host> -P <port> -u <user> -p cf_monitor < cf_monitor-2026-01-01.sql
```

丢失数据库的后果 = 丢账号配置（要重填 Account ID / Token）+ 丢历史趋势快照（从当天重新积累）+
丢收藏与默认视图设置。用量本身每次刷新都从 Cloudflare 重新拉，不会丢。

---

## 7. 升级

```bash
cd cf-source-monitor
git pull
bun install --frozen-lockfile      # 依赖有变时

# 表结构有变更时执行（幂等；本项目新增过 MetricFavorite / AppSetting 两张表）
bun run db:push

# Docker 部署
docker compose up -d --build

# 裸机部署
pm2 restart cf-monitor             # 或 systemctl restart cf-monitor
```

升级后建议跑一次 `curl -sS -X POST http://127.0.0.1:3000/api/monitor/refresh` 看返回
`{"ok":true,"errors":[],"refreshed":N}`。

---

## 8. 运维命令

```bash
# 容器状态与日志
docker compose ps
docker compose logs -f --tail 100 cf-monitor

# 构建日志（后台构建时）
tail -f ~/cf-monitor-build.log

# 手动触发采集 / 查看状态（走公网域名时记得带 Basic Auth）
curl -sS -X POST http://127.0.0.1:3000/api/monitor/refresh
curl -sS http://127.0.0.1:3000/api/monitor/status | head -c 300

# 演示模式开关
curl -sS -X POST   http://127.0.0.1:3000/api/demo    # 开启
curl -sS -X DELETE http://127.0.0.1:3000/api/demo    # 关闭

# 查快照（SQLite，时间字段是毫秒时间戳）
sqlite3 db/custom.db "select metric, datetime(capturedAt/1000,'unixepoch'), used
  from UsageSnapshot order by capturedAt desc limit 20;"

# 每个指标每天一行（正常情况不应有重复）
sqlite3 db/custom.db "select metric, count(*) c, count(distinct capturedAt) d
  from UsageSnapshot group by accountId, metric having c <> d;"
```

时区：额度按 **UTC 00:00** 重置，快照也按 UTC 日聚合，与 Cloudflare 一致。

---

## 9. FAQ

**Q：测试连接失败，提示 Token 无效？**
先确认 Token 类型。`cfat_` 前缀是 Account-owned Token，`/user/tokens/verify` 对它固定返回
`401 Invalid API Token`，必须用 `/accounts/{id}/tokens/verify`——所以**Account ID 必须一起填**。
程序已自动回落，若仍失败，用 README 里的自测命令核对权限。

**Q：采集报 `'limit' must be positive number and not greater than 10000`？**
Cloudflare GraphQL 单数据集 `limit` 上限是 10000。改小对应查询的 `limit` 即可（本项目已按上限设置）。

**Q：采集报 `cannot request a time range wider than 4w4d`？**
Cloudflare 对查询时间窗有限制，最长约 4 周 4 天，且各数据集不同（如 Images 只允许 `4w2d1h`）。
本项目 7 天窗口安全；若你要拉更长区间，按数据集分别限制窗口。

**Q：采集报 429 / 界面显示采集失败？**
Cloudflare 速率限制：GraphQL Analytics 约 300 请求 / 5 分钟 / 用户，REST 约 1200 请求 / 5 分钟 / 用户。
每个账号每次刷新用 3 次请求，单账号自动刷新（60s）远达不到上限；多标签页、频繁手动刷新、
或账号数很多时才会逼近。程序没有自动重试，遇到 429 稍后再刷即可。

**Q：面板数字和 Cloudflare 控制台对不上？**
分析数据一般滞后几分钟到几小时。程序行为：整批数据还没出当天 → 用最近可用一天填充；
数据集已更新但某项当天没数据 → 记 0。按日快照是「同一天只留一条」，重复刷新不会累积重复行。

**Q：Pages 拆分的项目名显示成数字 ID？**
需要 `Account → Cloudflare Pages → Read`。程序用 `pages_project` 的
`production_script_name` / `preview_script_name` 把脚本名里的数字 ID 映射回项目名
（注意该端点不接受 `per_page` 参数，传了会 400）。

**Q：拆分卡片显示「未知项目」？**
Cloudflare 分析数据里部分 Pages Functions 请求的 `scriptName` 就是 `__unknown__`，
官方没给归属信息。要定位只能开对应项目的 Workers Logs，或用 Zone 级 HTTP 分析
（需 `Zone → Analytics → Read`）按 host/path 查 5xx。

**Q：KV namespace 显示短 ID？**
需要 `Account → Workers KV Storage → Read` 才能列出 namespace 名称；另外 REST 只能列本账号的
namespace，其他账号创建的 namespace 无法解析名字，只能显示 ID。

**Q：趋势图只有今天一个点？**
快照从部署当天开始积累：日维度指标一次刷新会回填近 7 天，但月度 / 总量指标（如 R2 存储）
是每次刷新记一个点，需要几天才有曲线。次日即可看到两天对比。

**Q：刷新很慢或超时？**
一次刷新会对每个账号并发查询 Cloudflare（3 次请求），网络不佳时可能十几秒。Nginx 侧
`proxy_read_timeout` 建议 ≥120s（见方式三配置）。60 秒自动刷新与手动刷新不会并发执行，
前端有 `refreshing` 互斥。

**Q：如何修改服务端口？**
开发模式改 `package.json` 的 `dev` 脚本；生产 standalone 用 `PORT=8080 node .next/standalone/server.js`；
Docker 改 `docker-compose.yml` 的 `ports` 映射。

**Q：刷新时部分账号报错，其他正常？**
错误信息带账号名前缀，通常是该账号 Token 失效或权限不足；到「账号管理」编辑该账号重新测试连接。

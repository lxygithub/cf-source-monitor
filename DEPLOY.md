# 部署文档

本文档覆盖自托管部署的全部场景：数据库选型与配置（含 MySQL 避坑）、VPS / Docker / Vercel 三种部署方式、
反向代理与 HTTPS、安全加固、备份与升级。

先明确一个架构前提，避免部署时的常见误解：

```
浏览器 ──HTTP──▶ Next.js 服务端 ──Prisma──▶ 数据库
                    │
                    └──HTTPS──▶ Cloudflare API（只读查询用量）
```

- **前端不直连数据库**：浏览器只发出 `/api/*` 同源请求，数据库连接串只存在于服务端的 `.env`
- **服务端是唯一的数据库客户端**：部署时只需保证「运行 Next.js 的那台机器」能访问数据库即可，无需对浏览器暴露任何数据库端口
- **Cloudflare API 由服务端调用**：需要能访问 `api.cloudflare.com`（443 端口）

---

## 目录

1. [环境要求](#1-环境要求)
2. [数据库配置](#2-数据库配置)
   - [方案 A：SQLite（默认）](#方案-a-sqlite默认零配置)
   - [方案 B：MySQL](#方案-b-mysql)
   - [连接故障排查（实战六坑）](#连接故障排查实战六坑)
3. [部署方式](#3-部署方式)
   - [方式一：VPS 裸机（Bun/Node + PM2/systemd）](#方式一vps-裸机部署)
   - [方式二：Docker Compose（推荐）](#方式二docker-compose部署推荐)
   - [方式三：Vercel 等 Serverless](#方式三vercel-等-serverless)
4. [反向代理与 HTTPS](#4-反向代理与-https)
5. [安全加固](#5-安全加固必读)
6. [备份与恢复](#6-备份与恢复)
7. [升级](#7-升级)
8. [FAQ](#8-faq)

---

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| 运行时 | Bun 1.1+ 或 Node.js 20+（二选一） |
| 数据库 | SQLite（内置，零配置）/ MySQL 5.6+（已实测 5.7）/ MySQL 8.x |
| 出站网络 | 能访问 `api.cloudflare.com:443`；使用外部数据库时能访问其端口 |
| 内存 | 512 MB 起步即可 |

---

## 2. 数据库配置

### 方案 A：SQLite（默认，零配置）

适合单机自用。数据就是单个文件，备份即复制文件。

```bash
cp .env.example .env          # .env 中 DATABASE_URL=file:./db/custom.db
bun run db:push               # 建表，完成
```

生产环境建议把 `file:./db/custom.db` 改成**绝对路径**（如 `file:/var/lib/cf-monitor/custom.db`），
避免工作目录变化导致找不到库文件。

### 方案 B：MySQL

适合云数据库 / 多实例共享 / 需要更高可靠性的场景。Prisma 官方支持 MySQL 5.6.2+ 与 8.x
（5.7 与 8.0/8.4 均可，MySQL 8.4 默认的 `caching_sha2_password` 认证插件对 Prisma 无影响，
其内置客户端已支持；影响的是 Navicat 16 以下等老图形工具，见下文排查表）。

**三步切换：**

**① 建库**（关键：MySQL 5.7 服务端默认字符集是 `latin1`，不指定 utf8mb4 会导致中文账号名乱码）：

```sql
CREATE DATABASE IF NOT EXISTS cf_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

> 若数据库账号没有建库权限（部分云数据库只授予单库权限），请在云控制台先创建好库并确认其字符集为 utf8mb4。

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
# 模板（密码必须 URL 编码，见下表）
DATABASE_URL="mysql://用户名:URL编码后的密码@主机:端口/cf_monitor?connection_limit=10"

bun run db:push
```

#### 连接串特殊字符 URL 编码对照表

连接串是标准 URI，密码里的特殊字符**必须编码**，否则解析错误或连接被截断：

| 字符 | 编码 | 字符 | 编码 | 字符 | 编码 |
| --- | --- | --- | --- | --- | --- |
| `#` | `%23` | `[` | `%5B` | `]` | `%5D` |
| `@` | `%40` | `:` | `%3A` | `/` | `%2F` |
| `?` | `%3F` | `&` | `%26` | 空格 | `%20` |

示例：密码 `9s[BAL#h` → `9s%5BBAL%23h`，完整连接串：

```
mysql://myuser:9s%5BBAL%23h@db.example.com:34632/cf_monitor?connection_limit=10
```

#### 连接参数建议

| 参数 | 建议值 | 说明 |
| --- | --- | --- |
| `connection_limit` | 单机 `10`；Serverless `5` | Prisma 连接池大小，云数据库有最大连接数限制 |
| `connect_timeout` | `15` | 云数据库公网延迟高时适当加大 |
| `sslaccept` / `sslcert` | 视云商要求 | 部分托管 MySQL 强制 TLS 时配置 |

### 连接故障排查（实战六坑）

按命中概率排序，适用于任何"本机能连、服务器连不上"的场景：

| # | 坑 | 现象与验证 | 解法 |
| --- | --- | --- | --- |
| 1 | **端口用错** | 控制台写 3306 往往是**内网端口**；公网访问必须用控制台展示的映射端口（如 `34632`/`41139`） | 用公网地址 `IP:映射端口`；`nc -vz IP 端口` 先测连通性 |
| 2 | **用户名用错** | 外部账号通常是带随机后缀的（如 `rootXXXXXX`）；`root@localhost` 只允许数据库宿主机本机登录，外部用 root 会报 `Access denied for user 'root'@'你的IP'` | 使用控制台展示的完整用户名 |
| 3 | **特殊字符被吞** | shell 里 `-p'密码'` 不加引号，`#` 后内容会被当注释截断；URI 连接串里 `[` 等字符不编码会解析失败 | shell 引用加引号；连接串按上表 URL 编码 |
| 4 | **认证插件不兼容** | MySQL 8.4 默认 `caching_sha2_password`（且已移除 mysql_native_password），老版 Navicat（<16）、老 Workbench、老 JDBC/PHP 驱动报 `Authentication plugin 'caching_sha2_password' cannot be loaded` | 升级客户端；或改用 5.7 实例；Prisma 内置客户端两种插件都支持 |
| 5 | **IP 白名单** | 账号虽是 `user@%` 不限来源，但云控制台可能另配了外网白名单 | 查看数据库出口 IP：`curl ifconfig.me`，加入白名单 |
| 6 | **出站网络限制** | 服务器/容器环境可能禁止出站非标端口 | `nc -vz IP 端口` 或 `curl -v telnet://IP:端口` 测试；不通则找服务商放行，或让数据库换标准端口段 |

**通用排查顺序**：先 `nc -vz` 测 TCP（区分网络问题）→ 再 `mysql -h ... -P ... -u ...` 客户端测认证（区分凭据/插件问题）→ 最后看应用日志。

---

## 3. 部署方式

### 方式一：VPS 裸机部署

```bash
# 1. 拉代码
git clone https://github.com/lxygithub/cf-source-monitor.git
cd cf-source-monitor

# 2. 安装依赖（Bun 或 npm 二选一）
bun install                     # 或 npm install

# 3. 配置数据库
cp .env.example .env
vim .env                        # SQLite 直接用；MySQL 按上文切换
bun run db:push

# 4. 构建 + 启动
bun run build                   # 或 npm run build
bun run start                   # 或: PORT=3000 node .next/standalone/server.js
```

**用 PM2 守护（推荐）：**

```bash
npm i -g pm2
pm2 start ".next/standalone/server.js" --name cf-monitor \
  --env production -- --port 3000   # standalone 用 PORT 环境变量更稳：
PORT=3000 pm2 start .next/standalone/server.js --name cf-monitor
pm2 save && pm2 startup           # 开机自启
```

**用 systemd 守护：**

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
# .env 由 standalone server 自动读取；也可在此显式注入：
# Environment=DATABASE_URL=mysql://user:pass@host:3306/cf_monitor
ExecStart=/usr/bin/node /opt/cf-source-monitor/.next/standalone/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now cf-monitor
```

### 方式二：Docker Compose 部署（推荐）

仓库已内置 `Dockerfile` 与 `docker-compose.yml`：

```bash
git clone https://github.com/lxygithub/cf-source-monitor.git
cd cf-source-monitor
cp .env.example .env             # 按需改成 MySQL 连接串
docker compose up -d --build
```

- **SQLite**：compose 默认把 `./db` 挂载进容器持久化
- **MySQL**：编辑 `docker-compose.yml`，把 `DATABASE_URL` 环境变量换成 MySQL 连接串并注释掉 SQLite 行与卷挂载

> ⚠️ 容器访问宿主机上的 MySQL：主机地址写 `host.docker.internal`（Docker Desktop）或宿主机内网 IP；
> Linux 下可在 compose 中加 `extra_hosts: ["host.docker.internal:host-gateway"]`。

### 方式三：Vercel 等 Serverless

SQLite 基于本地文件，**Serverless 环境不可用**，必须使用外部 MySQL（或 PostgreSQL）：

1. 按上文切换 provider 并配置 `DATABASE_URL`（Vercel 项目环境变量里配置）
2. 连接串务必加 `?connection_limit=5`，避免 Serverless 高并发打爆云数据库最大连接数
3. 本地执行 `bun run db:push` 完成建表后再部署

---

## 4. 反向代理与 HTTPS

**Caddy（自动 HTTPS，最简单）：**

```caddyfile
monitor.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx：**

```nginx
server {
    listen 443 ssl;
    server_name monitor.example.com;
    ssl_certificate     /etc/ssl/certs/monitor.pem;
    ssl_certificate_key /etc/ssl/private/monitor.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 5. 安全加固（必读）

本应用**没有内建登录鉴权**——任何能打开页面的人都能看到用量面板、修改配置、
**读取你存储在数据库里的 Cloudflare Token 对应的账号信息**（Token 本身不回传，但配置接口可被调用）。
公网部署时至少做一项：

| 措施 | 做法 |
| --- | --- |
| 反代 Basic Auth（推荐） | Caddy：`basic_auth { user hashed_password }`；Nginx：`auth_basic` + `htpasswd` 文件 |
| IP 白名单 | 云防火墙 / 安全组只放行自己的出口 IP |
| 内网 / VPN 部署 | 不暴露公网，通过 Tailscale/WireGuard 访问 |

其他要点：

- Cloudflare API Token 创建时**只给只读权限**（见 README 权限表），即使泄露也无法改动账号资源
- 数据库**不要暴露公网**；云数据库务必使用强密码，并确认白名单策略
- 定期轮换 Cloudflare Token（账号管理里编辑账号、留空密码框即保持原 Token，填新值即轮换）

---

## 6. 备份与恢复

**SQLite：**

```bash
# 热备（推荐，不停服）
sqlite3 /path/to/custom.db ".backup '/backup/custom-$(date +%F).db'"
# 冷备：停服后直接复制文件即可
# 恢复：停服，用备份文件覆盖原路径，重启
```

**MySQL：**

```bash
# 备份（建议 crontab 每日执行）
mysqldump -h <host> -P <port> -u <user> -p cf_monitor > cf_monitor-$(date +%F).sql

# 恢复
mysql -h <host> -P <port> -u <user> -p cf_monitor < cf_monitor-2025-01-01.sql
```

丢失数据库的后果 = 丢失账号配置（需重填 Account ID / Token）+ 历史趋势快照（从当天重新积累）。当前用量数据每次刷新都会从 Cloudflare API 重新拉取，**不会丢失**。

---

## 7. 升级

```bash
cd cf-source-monitor
git pull
bun install                      # 或 npm install
bun run db:push                  # 表结构有变更时同步（幂等）
# 重启
pm2 restart cf-monitor           # 或 docker compose up -d --build，或 systemctl restart cf-monitor
```

---

## 8. FAQ

**Q：切换到 MySQL 后中文变成乱码/问号？**
建库时没指定 utf8mb4（MySQL 5.7 服务端默认 latin1）。见上文方案 B 第 ① 步；
已建错的库可执行 `ALTER DATABASE cf_monitor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` 后重灌数据。

**Q：`prisma db push` 报 P1001（连不上数据库）？**
按「实战六坑」排查：先 `nc -vz` 测 TCP 连通性，再核对用户名/密码编码/白名单。

**Q：页面打开是引导页，怎么开启演示模式？**
点引导页「一键演示」即可；或 `curl -X POST http://localhost:3000/api/demo` 开启、
`curl -X DELETE http://localhost:3000/api/demo` 退出（退出仅移除演示账号，不影响真实账号）。

**Q：快照趋势图只有今天一天？**
正常。快照从启用当天开始逐日积累，次日即可看到两天对比，7 天后趋势图完整。

**Q：如何修改服务端口？**
开发模式：`package.json` 中 `dev` 脚本的 `-p 3000`；生产 standalone：`PORT=8080 node .next/standalone/server.js`。

**Q：刷新时部分账号报错，其他账号正常？**
错误信息带账号名前缀，通常是该账号 Token 失效或权限不足；到「账号管理」编辑该账号重新测试连接即可。

# CF 资源余量监控 - 多阶段构建（standalone 输出）
# 构建阶段使用 Bun 安装依赖；运行阶段仅包含 standalone 产物，镜像体积小
FROM oven/bun:1 AS builder

WORKDIR /app

# 先复制依赖清单与锁文件，充分利用构建缓存
COPY package.json bun.lock* ./
COPY prisma ./prisma

RUN bun install --frozen-lockfile || bun install
RUN bun run db:generate

# 再复制源码并构建（build 脚本会自动把 static/public 复制进 standalone）
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ---------- 运行阶段 ----------
FROM oven/bun:1-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# standalone 产物（已含 static 与 public）
COPY --from=builder /app/.next/standalone ./

# 兜底：确保 Prisma 查询引擎随镜像分发（standalone 追踪通常已包含）
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# 非 root 运行
USER bun

EXPOSE 3000

CMD ["bun", "server.js"]

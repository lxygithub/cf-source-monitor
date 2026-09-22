// 监控服务层：配置管理、用量刷新、快照存储、状态组装、演示模式

import { db } from "@/lib/db";
import { METRIC_REGISTRY, getLevel } from "./metrics";
import type {
  ConfigInfo,
  MetricStatus,
  MonitorStatus,
} from "./types";
import {
  CloudflareApiError,
  classifyR2Action,
  getD1StorageBytes,
  queryR2MonthlyOperations,
  queryUsageTrend,
} from "./cloudflare";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEMO_ACCOUNT_ID = "demo";

// ---------------------------------------------------------------------------
// 时间工具（Cloudflare 免费额度按 UTC 重置）
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function utcMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// ---------------------------------------------------------------------------
// 账号配置
// ---------------------------------------------------------------------------

export async function getAccount() {
  return db.cfAccount.findFirst({ orderBy: { createdAt: "asc" } });
}

export async function getConfigInfo(): Promise<ConfigInfo> {
  const account = await getAccount();
  if (!account) return { configured: false, demo: false };
  return {
    configured: true,
    demo: account.accountId === DEMO_ACCOUNT_ID,
    name: account.name,
    accountId: account.accountId,
    hasToken: account.apiToken.length > 0,
  };
}

export async function saveConfig(input: {
  name?: string;
  accountId: string;
  apiToken: string;
}) {
  const existing = await getAccount();
  if (existing) {
    // 换了账号则清理旧数据
    if (existing.accountId !== input.accountId) {
      await db.metricQuota.deleteMany({ where: { accountId: existing.accountId } });
      await db.usageSnapshot.deleteMany({ where: { accountId: existing.accountId } });
      await db.customMetric.deleteMany({ where: { accountId: existing.accountId } });
      await db.cfAccount.delete({ where: { id: existing.id } });
    } else {
      await db.cfAccount.update({
        where: { id: existing.id },
        data: {
          name: input.name?.trim() || "Cloudflare 账号",
          apiToken: input.apiToken,
        },
      });
      return;
    }
  }
  await db.cfAccount.create({
    data: {
      name: input.name?.trim() || "Cloudflare 账号",
      accountId: input.accountId,
      apiToken: input.apiToken,
    },
  });
}

export async function clearConfig() {
  await db.cfAccount.deleteMany({});
  await db.metricQuota.deleteMany({});
  await db.usageSnapshot.deleteMany({});
  await db.customMetric.deleteMany({});
}

// ---------------------------------------------------------------------------
// 配额
// ---------------------------------------------------------------------------

async function ensureDefaultQuotas(accountId: string) {
  const rows = await db.metricQuota.findMany({ where: { accountId } });
  const have = new Set(rows.map((r) => r.metric));
  const missing = METRIC_REGISTRY.filter((m) => !have.has(m.id));
  if (missing.length > 0) {
    await db.metricQuota.createMany({
      data: missing.map((m) => ({
        accountId,
        metric: m.id,
        quota: m.defaultQuota,
      })),
    });
  }
}

export async function getQuotaMap(accountId: string): Promise<Map<string, number>> {
  await ensureDefaultQuotas(accountId);
  const rows = await db.metricQuota.findMany({ where: { accountId } });
  const map = new Map<string, number>();
  for (const m of METRIC_REGISTRY) map.set(m.id, m.defaultQuota);
  for (const r of rows) map.set(r.metric, r.quota);
  return map;
}

export async function setQuota(accountId: string, metric: string, quota: number) {
  const existing = await db.metricQuota.findFirst({
    where: { accountId, metric },
  });
  if (existing) {
    await db.metricQuota.update({ where: { id: existing.id }, data: { quota } });
  } else {
    await db.metricQuota.create({ data: { accountId, metric, quota } });
  }
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

type MetricValues = Record<string, number | null>;

async function saveDailySnapshot(
  accountId: string,
  metric: string,
  used: number,
  day: Date
) {
  const dayStart = utcDayStart(day);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const exists = await db.usageSnapshot.findFirst({
    where: {
      accountId,
      metric,
      capturedAt: { gte: dayStart, lt: dayEnd },
    },
  });
  if (exists) {
    await db.usageSnapshot.update({
      where: { id: exists.id },
      data: { used },
    });
  } else {
    await db.usageSnapshot.create({
      data: { accountId, metric, used, capturedAt: new Date() },
    });
  }
}

async function savePointSnapshot(accountId: string, metric: string, used: number) {
  await db.usageSnapshot.create({
    data: { accountId, metric, used, capturedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// 真实账号刷新
// ---------------------------------------------------------------------------

export async function refreshRealAccount(
  accountId: string,
  apiToken: string
): Promise<{ values: MetricValues; errors: string[] }> {
  const errors: string[] = [];
  const values: MetricValues = {};
  const now = new Date();
  const weekStart = new Date(utcDayStart(now).getTime() - 6 * DAY_MS);

  try {
    const data = await queryUsageTrend(
      apiToken,
      accountId,
      weekStart.toISOString(),
      now.toISOString(),
      isoDate(weekStart),
      isoDate(now)
    );
    const acc = data?.viewer?.accounts?.[0];
    if (!acc) {
      throw new CloudflareApiError("无法读取账号分析数据，请检查 Token 权限");
    }

    // Workers 请求（按日）
    const workersByDate = new Map<string, number>();
    for (const row of acc.workersInvocationsAdaptive ?? []) {
      workersByDate.set(
        row.dimensions.date,
        (workersByDate.get(row.dimensions.date) ?? 0) + (row.sum?.requests ?? 0)
      );
    }
    values.workers_requests = workersByDate.get(isoDate(now)) ?? 0;

    // D1 行读取/写入（按日）
    const d1ReadByDate = new Map<string, number>();
    const d1WrittenByDate = new Map<string, number>();
    for (const row of acc.d1AnalyticsAdaptiveGroups ?? []) {
      const s = row.sum;
      if (!s) continue;
      d1ReadByDate.set(
        row.dimensions.date,
        (d1ReadByDate.get(row.dimensions.date) ?? 0) + s.rowsRead
      );
      d1WrittenByDate.set(
        row.dimensions.date,
        (d1WrittenByDate.get(row.dimensions.date) ?? 0) + s.rowsWritten
      );
    }
    values.d1_rows_read = d1ReadByDate.get(isoDate(now)) ?? 0;
    values.d1_rows_written = d1WrittenByDate.get(isoDate(now)) ?? 0;

    // R2 存储（取最近一天）
    const r2StorageRows = acc.r2StorageAdaptiveGroups ?? [];
    if (r2StorageRows.length > 0) {
      const latest = r2StorageRows[0];
      const bytes =
        (latest.max?.payloadSize ?? 0) + (latest.max?.metadataSize ?? 0);
      values.r2_storage = bytes / 1024 ** 3;
    } else {
      values.r2_storage = 0;
    }

    // 近 7 日 R2 操作（分类 A/B，按日）
    const r2Ops7d = acc.r2OperationsAdaptiveGroups ?? [];
    const classA7d = new Map<string, number>();
    const classB7d = new Map<string, number>();
    for (const row of r2Ops7d) {
      const cls = classifyR2Action(row.dimensions.actionType);
      if (!cls || !row.dimensions.date) continue;
      const target = cls === "A" ? classA7d : classB7d;
      target.set(
        row.dimensions.date,
        (target.get(row.dimensions.date) ?? 0) + (row.sum?.requests ?? 0)
      );
    }

    // 本月 R2 操作
    const monthly = await queryR2MonthlyOperations(
      apiToken,
      accountId,
      utcMonthStart(now).toISOString(),
      now.toISOString()
    );
    const monthlyRows =
      monthly?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups ?? [];
    let monthA = 0;
    let monthB = 0;
    for (const row of monthlyRows) {
      const cls = classifyR2Action(row.dimensions.actionType);
      if (!cls) continue;
      if (cls === "A") monthA += row.sum?.requests ?? 0;
      else monthB += row.sum?.requests ?? 0;
    }
    // 本月数据不足时（月初 7 天覆盖），合并 7 日明细
    const monthStartDate = isoDate(utcMonthStart(now));
    if (isoDate(weekStart) <= monthStartDate) {
      // 7 日窗口已覆盖月初，用 7 日明细的今日值即可，不重复累计
    }
    values.r2_class_a = monthA;
    values.r2_class_b = monthB;

    // D1 存储总量（REST）
    const d1Bytes = await getD1StorageBytes(apiToken, accountId);
    if (d1Bytes === null) {
      errors.push("D1 存储用量获取失败（缺少 D1:Read 权限或账号无 D1）");
      values.d1_storage = null;
    } else {
      values.d1_storage = d1Bytes / 1024 ** 3;
    }

    // ---- 写入快照 ----
    await ensureDefaultQuotas(accountId);

    // 每日指标：回填近 7 日（已存在则更新）
    const dailySeries: [string, Map<string, number>][] = [
      ["workers_requests", workersByDate],
      ["d1_rows_read", d1ReadByDate],
      ["d1_rows_written", d1WrittenByDate],
    ];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(utcDayStart(now).getTime() - i * DAY_MS);
      const key = isoDate(day);
      for (const [metric, map] of dailySeries) {
        const v = map.get(key);
        if (v !== undefined) await saveDailySnapshot(accountId, metric, v, day);
      }
    }
    // R2 每日操作也回填（用于趋势展示）
    for (const [metric, map] of [
      ["r2_class_a", classA7d],
      ["r2_class_b", classB7d],
    ] as [string, Map<string, number>][]) {
      for (const [date, v] of map) {
        await saveDailySnapshot(accountId, metric, v, new Date(`${date}T00:00:00Z`));
      }
    }

    // 月度 / 总量指标：每次刷新记一个点
    await savePointSnapshot(accountId, "r2_class_a", values.r2_class_a ?? 0);
    await savePointSnapshot(accountId, "r2_class_b", values.r2_class_b ?? 0);
    await savePointSnapshot(accountId, "r2_storage", values.r2_storage ?? 0);
    if (values.d1_storage !== null) {
      await savePointSnapshot(accountId, "d1_storage", values.d1_storage);
    }
  } catch (err) {
    const msg =
      err instanceof CloudflareApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "未知错误";
    errors.push(`用量采集失败：${msg}`);
  }

  return { values, errors };
}

// ---------------------------------------------------------------------------
// 演示模式
// ---------------------------------------------------------------------------

const DEMO_BASE: Record<string, number> = {
  workers_requests: 61_500,
  r2_class_a: 352_000,
  r2_class_b: 4_210_000,
  r2_storage: 4.6,
  d1_rows_read: 1_860_000,
  d1_rows_written: 88_300,
  d1_storage: 1.2,
};

export async function seedDemo() {
  await clearConfig();
  await db.cfAccount.create({
    data: {
      name: "演示账号（模拟数据）",
      accountId: DEMO_ACCOUNT_ID,
      apiToken: "demo-token",
    },
  });
  await ensureDefaultQuotas(DEMO_ACCOUNT_ID);

  const now = new Date();
  const today = utcDayStart(now);

  // 近 7 日每日指标历史（含今日）
  const dailyHistory: Record<string, (dayOffset: number) => number> = {
    workers_requests: (i) => Math.round(42_000 + Math.random() * 30_000),
    d1_rows_read: (i) => Math.round(1_200_000 + Math.random() * 900_000),
    d1_rows_written: (i) => Math.round(45_000 + Math.random() * 50_000),
    r2_class_a: () => Math.round(280_000 + Math.random() * 90_000),
    r2_class_b: () => Math.round(3_600_000 + Math.random() * 800_000),
  };
  for (let i = 6; i >= 1; i--) {
    const day = new Date(today.getTime() - i * DAY_MS);
    for (const [metric, gen] of Object.entries(dailyHistory)) {
      await db.usageSnapshot.create({
        data: {
          accountId: DEMO_ACCOUNT_ID,
          metric,
          used: gen(i),
          capturedAt: day,
        },
      });
    }
  }

  // 今日快照
  const todayValues: MetricValues = { ...DEMO_BASE };
  for (const [metric, used] of Object.entries(todayValues)) {
    await saveDailySnapshot(DEMO_ACCOUNT_ID, metric, used, now);
  }
  await savePointSnapshot(DEMO_ACCOUNT_ID, "r2_storage", DEMO_BASE.r2_storage);
  await savePointSnapshot(DEMO_ACCOUNT_ID, "d1_storage", DEMO_BASE.d1_storage);

  // 自定义指标（API 无法自动获取的资源）
  await db.customMetric.createMany({
    data: [
      {
        accountId: DEMO_ACCOUNT_ID,
        name: "KV 读取次数",
        unit: "次",
        period: "day",
        quota: 100_000,
        used: 52_400,
      },
      {
        accountId: DEMO_ACCOUNT_ID,
        name: "KV 写入次数",
        unit: "次",
        period: "day",
        quota: 1_000,
        used: 942,
      },
      {
        accountId: DEMO_ACCOUNT_ID,
        name: "Pages 构建次数",
        unit: "次",
        period: "month",
        quota: 500,
        used: 468,
      },
    ],
  });
}

export async function refreshDemo(): Promise<{ errors: string[] }> {
  const now = new Date();
  const latest = await latestSnapshotMap(DEMO_ACCOUNT_ID);
  const errors: string[] = [];

  const quotaMap = await getQuotaMap(DEMO_ACCOUNT_ID);
  const walk = (metric: string, minPct: number, maxPct: number) => {
    const quota = quotaMap.get(metric) ?? 1;
    const base = latest.get(metric)?.used ?? quota * 0.3;
    const next = Math.min(
      base * (1 + (Math.random() * (maxPct - minPct) + minPct) / 100),
      quota * 1.05
    );
    return next;
  };

  await saveDailySnapshot(
    DEMO_ACCOUNT_ID,
    "workers_requests",
    Math.round(walk("workers_requests", 0.5, 3)),
    now
  );
  await saveDailySnapshot(
    DEMO_ACCOUNT_ID,
    "d1_rows_read",
    Math.round(walk("d1_rows_read", 0.5, 4)),
    now
  );
  await saveDailySnapshot(
    DEMO_ACCOUNT_ID,
    "d1_rows_written",
    Math.round(walk("d1_rows_written", 0.3, 2)),
    now
  );
  await savePointSnapshot(
    DEMO_ACCOUNT_ID,
    "r2_class_a",
    Math.round(walk("r2_class_a", 0.2, 1.5))
  );
  await savePointSnapshot(
    DEMO_ACCOUNT_ID,
    "r2_class_b",
    Math.round(walk("r2_class_b", 0.2, 1.5))
  );
  await savePointSnapshot(DEMO_ACCOUNT_ID, "r2_storage", walk("r2_storage", -1, 1));
  await savePointSnapshot(DEMO_ACCOUNT_ID, "d1_storage", walk("d1_storage", -0.5, 0.5));

  // 自定义指标同步增长
  const customs = await db.customMetric.findMany({
    where: { accountId: DEMO_ACCOUNT_ID },
  });
  for (const c of customs) {
    await db.customMetric.update({
      where: { id: c.id },
      data: {
        used: Math.min(
          c.used + Math.round(c.quota * (Math.random() * 0.02 + 0.002)),
          c.quota * 1.05
        ),
      },
    });
  }

  return { errors };
}

export async function exitDemo() {
  await clearConfig();
}

// ---------------------------------------------------------------------------
// 状态组装
// ---------------------------------------------------------------------------

async function latestSnapshotMap(accountId: string): Promise<Map<string, { used: number; capturedAt: Date }>> {
  const metrics = new Set(METRIC_REGISTRY.map((m) => m.id));
  const customs = await db.customMetric.findMany({
    where: { accountId },
    select: { name: true },
  });
  for (const c of customs) metrics.add(`custom:${c.name}`);

  const map = new Map<string, { used: number; capturedAt: Date }>();
  for (const metric of metrics) {
    if (metric.startsWith("custom:")) continue; // 自定义指标实时读取
    const snap = await db.usageSnapshot.findFirst({
      where: { accountId, metric },
      orderBy: { capturedAt: "desc" },
    });
    if (snap) map.set(metric, { used: snap.used, capturedAt: snap.capturedAt });
  }
  return map;
}

async function historyFor(
  accountId: string,
  metric: string,
  days = 7
): Promise<{ date: string; used: number }[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const snaps = await db.usageSnapshot.findMany({
    where: { accountId, metric, capturedAt: { gte: since } },
    orderBy: { capturedAt: "asc" },
  });
  const byDate = new Map<string, number>();
  for (const s of snaps) byDate.set(isoDate(s.capturedAt), s.used);
  return Array.from(byDate.entries()).map(([date, used]) => ({ date, used }));
}

export async function getStatus(errors: string[] = []): Promise<MonitorStatus> {
  const config = await getConfigInfo();
  if (!config.configured) {
    return {
      config,
      lastRefreshAt: null,
      metrics: [],
      summary: { total: 0, ok: 0, warning: 0, danger: 0, over: 0, nodata: 0 },
      errors,
    };
  }
  const accountId = config.accountId!;
  const quotaMap = await getQuotaMap(accountId);
  const latest = await latestSnapshotMap(accountId);

  const metrics: MetricStatus[] = [];

  // 内置指标
  for (const def of METRIC_REGISTRY) {
    const used = latest.get(def.id)?.used ?? null;
    const quota = quotaMap.get(def.id) ?? def.defaultQuota;
    const percent = used === null ? null : (used / quota) * 100;
    metrics.push({
      metric: def.id,
      label: def.label,
      description: def.description,
      unit: def.unit,
      period: def.period,
      category: def.category,
      used,
      quota,
      percent,
      remaining: used === null ? null : quota - used,
      level: getLevel(percent),
      custom: false,
      history: await historyFor(accountId, def.id),
    });
  }

  // 自定义指标
  const customs = await db.customMetric.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
  });
  for (const c of customs) {
    const percent = (c.used / c.quota) * 100;
    metrics.push({
      metric: `custom:${c.name}`,
      label: c.name,
      description: "自定义监控指标（手动记录）",
      unit: c.unit,
      period: c.period as MetricStatus["period"],
      category: "custom",
      used: c.used,
      quota: c.quota,
      percent,
      remaining: c.quota - c.used,
      level: getLevel(percent),
      custom: true,
      customId: c.id,
      history: [],
    });
  }

  const summary = {
    total: metrics.length,
    ok: metrics.filter((m) => m.level === "ok").length,
    warning: metrics.filter((m) => m.level === "warning").length,
    danger: metrics.filter((m) => m.level === "danger").length,
    over: metrics.filter((m) => m.level === "over").length,
    nodata: metrics.filter((m) => m.level === "nodata").length,
  };

  const lastRefreshAt =
    latest.size > 0
      ? Array.from(latest.values())
          .map((v) => v.capturedAt)
          .sort((a, b) => b.getTime() - a.getTime())[0]
          .toISOString()
      : null;

  return { config, lastRefreshAt, metrics, summary, errors };
}

// 监控服务层：多账号配置、用量刷新、快照存储、状态组装、演示模式

import { db } from "@/lib/db";
import { METRIC_REGISTRY, getLevel } from "./metrics";
import type {
  AccountGroup,
  AccountInfo,
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

/** 演示账号的 Cloudflare Account ID 集合 */
export const DEMO_ACCOUNT_IDS = ["demo", "demo-b"];

function isDemoAccountId(accountId: string): boolean {
  return DEMO_ACCOUNT_IDS.includes(accountId);
}

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
// 账号管理（多账号）
// ---------------------------------------------------------------------------

export async function getAccounts() {
  return db.cfAccount.findMany({ orderBy: { createdAt: "asc" } });
}

function toAccountInfo(a: {
  id: string;
  name: string;
  accountId: string;
}): AccountInfo {
  return { id: a.id, name: a.name, accountId: a.accountId, demo: isDemoAccountId(a.accountId) };
}

export async function listAccountInfos(): Promise<AccountInfo[]> {
  return (await getAccounts()).map(toAccountInfo);
}

export async function addAccount(input: {
  name?: string;
  accountId: string;
  apiToken: string;
}) {
  const accountId = input.accountId.trim();
  const dup = await db.cfAccount.findUnique({ where: { accountId } });
  if (dup) {
    return { ok: false as const, error: "该 Account ID 已存在，无需重复添加" };
  }
  const account = await db.cfAccount.create({
    data: {
      name: input.name?.trim() || "Cloudflare 账号",
      accountId,
      apiToken: input.apiToken.trim(),
    },
  });
  await ensureDefaultQuotas(accountId);
  return { ok: true as const, account };
}

export async function updateAccount(
  id: string,
  input: { name?: string; accountId?: string; apiToken?: string }
) {
  const account = await db.cfAccount.findUnique({ where: { id } });
  if (!account) {
    return { ok: false as const, error: "账号不存在" };
  }
  const newCfId = input.accountId?.trim();
  if (newCfId && newCfId !== account.accountId) {
    const dup = await db.cfAccount.findUnique({ where: { accountId: newCfId } });
    if (dup) {
      return { ok: false as const, error: "该 Account ID 已被其他账号使用" };
    }
    // Cloudflare Account ID 变化，旧数据全部清理
    await db.metricQuota.deleteMany({ where: { accountId: account.accountId } });
    await db.usageSnapshot.deleteMany({ where: { accountId: account.accountId } });
    await db.customMetric.deleteMany({ where: { accountId: account.accountId } });
  }
  await db.cfAccount.update({
    where: { id },
    data: {
      name: input.name?.trim() || account.name,
      accountId: newCfId || account.accountId,
      // Token 留空表示保持不变
      apiToken: input.apiToken?.trim() || account.apiToken,
    },
  });
  if (newCfId) await ensureDefaultQuotas(newCfId);
  return { ok: true as const };
}

export async function deleteAccount(id: string) {
  const account = await db.cfAccount.findUnique({ where: { id } });
  if (!account) return;
  await db.metricQuota.deleteMany({ where: { accountId: account.accountId } });
  await db.usageSnapshot.deleteMany({ where: { accountId: account.accountId } });
  await db.customMetric.deleteMany({ where: { accountId: account.accountId } });
  await db.cfAccount.delete({ where: { id } });
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

async function getQuotaMap(accountId: string): Promise<Map<string, number>> {
  await ensureDefaultQuotas(accountId);
  const rows = await db.metricQuota.findMany({ where: { accountId } });
  const map = new Map<string, number>();
  for (const m of METRIC_REGISTRY) map.set(m.id, m.defaultQuota);
  for (const r of rows) map.set(r.metric, r.quota);
  return map;
}

export async function setQuota(
  accountId: string,
  metric: string,
  quota: number
) {
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

async function savePointSnapshot(
  accountId: string,
  metric: string,
  used: number
) {
  await db.usageSnapshot.create({
    data: { accountId, metric, used, capturedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// 真实账号用量采集
// ---------------------------------------------------------------------------

async function refreshRealAccount(
  accountId: string,
  apiToken: string
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
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

    // R2 存储（取最近一天）
    const r2StorageRows = acc.r2StorageAdaptiveGroups ?? [];
    const r2StorageBytes =
      r2StorageRows.length > 0
        ? (r2StorageRows[0].max?.payloadSize ?? 0) +
          (r2StorageRows[0].max?.metadataSize ?? 0)
        : 0;

    // 近 7 日 R2 操作（分类 A/B，按日）
    const classA7d = new Map<string, number>();
    const classB7d = new Map<string, number>();
    for (const row of acc.r2OperationsAdaptiveGroups ?? []) {
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

    // D1 存储总量（REST）
    const d1Bytes = await getD1StorageBytes(apiToken, accountId);
    if (d1Bytes === null) {
      errors.push("D1 存储用量获取失败（缺少 D1:Read 权限或账号无 D1）");
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
    for (const [metric, map] of [
      ["r2_class_a", classA7d],
      ["r2_class_b", classB7d],
    ] as [string, Map<string, number>][]) {
      for (const [date, v] of map) {
        await saveDailySnapshot(accountId, metric, v, new Date(`${date}T00:00:00Z`));
      }
    }

    // 月度 / 总量指标：每次刷新记一个点
    await savePointSnapshot(accountId, "r2_class_a", monthA);
    await savePointSnapshot(accountId, "r2_class_b", monthB);
    await savePointSnapshot(accountId, "r2_storage", r2StorageBytes / 1024 ** 3);
    if (d1Bytes !== null) {
      await savePointSnapshot(accountId, "d1_storage", d1Bytes / 1024 ** 3);
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

  return { errors };
}

// ---------------------------------------------------------------------------
// 演示模式（双演示账号）
// ---------------------------------------------------------------------------

interface DemoSpec {
  accountId: string;
  name: string;
  base: {
    workers_requests: number;
    r2_class_a: number;
    r2_class_b: number;
    r2_storage: number;
    d1_rows_read: number;
    d1_rows_written: number;
    d1_storage: number;
  };
  customs: {
    name: string;
    unit: string;
    period: string;
    quota: number;
    used: number;
  }[];
}

const DEMO_SPECS: DemoSpec[] = [
  {
    accountId: "demo",
    name: "演示账号 A（模拟数据）",
    base: {
      workers_requests: 61_500,
      r2_class_a: 352_000,
      r2_class_b: 4_210_000,
      r2_storage: 4.6,
      d1_rows_read: 1_860_000,
      d1_rows_written: 88_300,
      d1_storage: 1.2,
    },
    customs: [
      { name: "KV 读取次数", unit: "次", period: "day", quota: 100_000, used: 52_400 },
      { name: "KV 写入次数", unit: "次", period: "day", quota: 1_000, used: 942 },
      { name: "Pages 构建次数", unit: "次", period: "month", quota: 500, used: 468 },
    ],
  },
  {
    accountId: "demo-b",
    name: "演示账号 B（模拟数据）",
    base: {
      workers_requests: 24_800,
      r2_class_a: 88_400,
      r2_class_b: 1_650_000,
      r2_storage: 1.3,
      d1_rows_read: 640_000,
      d1_rows_written: 21_500,
      d1_storage: 0.4,
    },
    customs: [
      { name: "KV 读取次数", unit: "次", period: "day", quota: 100_000, used: 31_200 },
      { name: "Pages 构建次数", unit: "次", period: "month", quota: 500, used: 128 },
    ],
  },
];

async function seedOneDemo(spec: DemoSpec) {
  const existing = await db.cfAccount.findUnique({
    where: { accountId: spec.accountId },
  });
  if (!existing) {
    await db.cfAccount.create({
      data: {
        name: spec.name,
        accountId: spec.accountId,
        apiToken: "demo-token",
      },
    });
  }
  // 重置该演示账号的数据
  await db.usageSnapshot.deleteMany({ where: { accountId: spec.accountId } });
  await db.customMetric.deleteMany({ where: { accountId: spec.accountId } });
  await ensureDefaultQuotas(spec.accountId);

  const now = new Date();
  const today = utcDayStart(now);

  // 近 7 日每日指标历史（不含今日）
  const dailyBase: [string, number][] = [
    ["workers_requests", spec.base.workers_requests],
    ["d1_rows_read", spec.base.d1_rows_read],
    ["d1_rows_written", spec.base.d1_rows_written],
    ["r2_class_a", spec.base.r2_class_a],
    ["r2_class_b", spec.base.r2_class_b],
  ];
  for (let i = 6; i >= 1; i--) {
    const day = new Date(today.getTime() - i * DAY_MS);
    for (const [metric, baseV] of dailyBase) {
      const factor =
        metric.startsWith("r2") || metric === "d1_rows_written"
          ? 0.72 + Math.random() * 0.22
          : 0.6 + Math.random() * 0.35;
      await db.usageSnapshot.create({
        data: {
          accountId: spec.accountId,
          metric,
          used: Math.round(baseV * factor),
          capturedAt: day,
        },
      });
    }
  }

  // 今日快照
  for (const [metric, v] of dailyBase) {
    await saveDailySnapshot(spec.accountId, metric, v, now);
  }
  await savePointSnapshot(spec.accountId, "r2_storage", spec.base.r2_storage);
  await savePointSnapshot(spec.accountId, "d1_storage", spec.base.d1_storage);

  // 自定义指标
  if (spec.customs.length > 0) {
    await db.customMetric.createMany({
      data: spec.customs.map((c) => ({ ...c, accountId: spec.accountId })),
    });
  }
}

/** 添加 / 重置演示账号（不影响已配置的真实账号） */
export async function seedDemo() {
  for (const spec of DEMO_SPECS) {
    await seedOneDemo(spec);
  }
}

async function refreshDemo(accountId: string): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const now = new Date();
  const latest = await latestSnapshotMap(accountId);
  const quotaMap = await getQuotaMap(accountId);

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
    accountId,
    "workers_requests",
    Math.round(walk("workers_requests", 0.5, 3)),
    now
  );
  await saveDailySnapshot(
    accountId,
    "d1_rows_read",
    Math.round(walk("d1_rows_read", 0.5, 4)),
    now
  );
  await saveDailySnapshot(
    accountId,
    "d1_rows_written",
    Math.round(walk("d1_rows_written", 0.3, 2)),
    now
  );
  await savePointSnapshot(
    accountId,
    "r2_class_a",
    Math.round(walk("r2_class_a", 0.2, 1.5))
  );
  await savePointSnapshot(
    accountId,
    "r2_class_b",
    Math.round(walk("r2_class_b", 0.2, 1.5))
  );
  await savePointSnapshot(accountId, "r2_storage", walk("r2_storage", -1, 1));
  await savePointSnapshot(accountId, "d1_storage", walk("d1_storage", -0.5, 0.5));

  // 自定义指标同步增长
  const customs = await db.customMetric.findMany({ where: { accountId } });
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

/** 移除全部演示账号（不影响真实账号） */
export async function exitDemo() {
  const demos = await db.cfAccount.findMany({
    where: { accountId: { in: DEMO_ACCOUNT_IDS } },
  });
  for (const d of demos) {
    await deleteAccount(d.id);
  }
}

// ---------------------------------------------------------------------------
// 刷新入口
// ---------------------------------------------------------------------------

/** 刷新指定账号（ids 非空）或全部账号 */
export async function refreshAccounts(
  ids?: string[]
): Promise<{ errors: string[]; refreshed: number }> {
  const accounts = await getAccounts();
  const targets =
    ids && ids.length > 0
      ? accounts.filter((a) => ids.includes(a.id))
      : accounts;
  const errors: string[] = [];

  for (const account of targets) {
    let accountErrors: string[];
    if (isDemoAccountId(account.accountId)) {
      ({ errors: accountErrors } = await refreshDemo(account.accountId));
    } else {
      ({ errors: accountErrors } = await refreshRealAccount(
        account.accountId,
        account.apiToken
      ));
    }
    for (const e of accountErrors) {
      errors.push(`[${account.name}] ${e}`);
    }
  }

  return { errors, refreshed: targets.length };
}

// ---------------------------------------------------------------------------
// 状态组装
// ---------------------------------------------------------------------------

async function latestSnapshotMap(
  accountId: string
): Promise<Map<string, { used: number; capturedAt: Date }>> {
  const metrics = new Set(METRIC_REGISTRY.map((m) => m.id));
  const map = new Map<string, { used: number; capturedAt: Date }>();
  for (const metric of metrics) {
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

async function buildGroup(account: {
  id: string;
  name: string;
  accountId: string;
}): Promise<AccountGroup> {
  const accountId = account.accountId;
  const quotaMap = await getQuotaMap(accountId);
  const latest = await latestSnapshotMap(accountId);

  const metrics: MetricStatus[] = [];

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
      accountDbId: account.id,
      accountId,
      accountName: account.name,
    });
  }

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
      accountDbId: account.id,
      accountId,
      accountName: account.name,
    });
  }

  const lastRefreshAt =
    latest.size > 0
      ? Array.from(latest.values())
          .map((v) => v.capturedAt)
          .sort((a, b) => b.getTime() - a.getTime())[0]
          .toISOString()
      : null;

  return {
    id: account.id,
    name: account.name,
    accountId,
    demo: isDemoAccountId(accountId),
    lastRefreshAt,
    metrics,
    builtin: metrics.filter((m) => !m.custom),
    custom: metrics.filter((m) => m.custom),
  };
}

export async function getStatus(view = "all"): Promise<MonitorStatus> {
  const accountList = await listAccountInfos();
  const groups: AccountGroup[] = [];

  for (const account of await getAccounts()) {
    if (view !== "all" && account.id !== view) continue;
    groups.push(await buildGroup(account));
  }

  const allMetrics = groups.flatMap((g) => g.metrics);
  const summary = {
    total: allMetrics.length,
    ok: allMetrics.filter((m) => m.level === "ok").length,
    warning: allMetrics.filter((m) => m.level === "warning").length,
    danger: allMetrics.filter((m) => m.level === "danger").length,
    over: allMetrics.filter((m) => m.level === "over").length,
    nodata: allMetrics.filter((m) => m.level === "nodata").length,
  };

  const lastRefreshAt =
    groups
      .map((g) => g.lastRefreshAt)
      .filter((t): t is string => t !== null)
      .sort()
      .pop() ?? null;

  return {
    view,
    accounts: groups,
    accountList,
    accountCount: accountList.length,
    lastRefreshAt,
    summary,
    errors: [],
  };
}

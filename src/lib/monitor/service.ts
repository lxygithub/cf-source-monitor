// 监控服务层：多账号配置、用量刷新、快照存储、状态组装、演示模式

import { db } from "@/lib/db";
import { METRIC_MAP, METRIC_REGISTRY, getLevel } from "./metrics";
import type {
  AccountGroup,
  AccountInfo,
  MetricDef,
  MetricStatus,
  MonitorStatus,
} from "./types";
import {
  CloudflareApiError,
  classifyR2Action,
  getD1DatabaseNames,
  getD1StorageBytes,
  getKvNamespaceNames,
  getPagesProjectNames,
  queryR2MonthlyOperations,
  queryExtendedUsage,
  queryUsageTrend,
  type ExtendedUsageData,
} from "./cloudflare";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 拆分视图：KV 按 namespace、D1 按数据库
// 指标 ID 形如 `kv_reads|ns|<namespaceId>`、`d1_storage|db|<uuid>`
// ---------------------------------------------------------------------------

const SPLIT_SEP = "|";

type SplitScope = "ns" | "db" | "pj";

function splitMetricId(base: string, scope: SplitScope, id: string) {
  return `${base}${SPLIT_SEP}${scope}${SPLIT_SEP}${id}`;
}

function parseSplitMetricId(
  metric: string
): { base: string; scope: SplitScope; id: string } | null {
  const parts = metric.split(SPLIT_SEP);
  if (parts.length !== 3) return null;
  const [base, scope, id] = parts;
  if (scope !== "ns" && scope !== "db" && scope !== "pj") return null;
  if (!METRIC_MAP.has(base) || !id) return null;
  return { base, scope: scope as SplitScope, id };
}

/** Pages 脚本名 → 项目 ID：pages-worker--<projectId>-production */
function pagesProjectId(scriptName: string) {
  const matched = /^pages-worker--(.+?)-(production|preview|staging)$/.exec(
    scriptName
  );
  return matched ? matched[1] : scriptName;
}

/** 资源名称缓存（KV namespace / D1 库名）：刷新时填充，读取状态时不再打 Cloudflare */
const NAME_CACHE_TTL = 6 * 60 * 60 * 1000;
const resourceNameCache = new Map<
  string,
  {
    at: number;
    ns: Map<string, string>;
    db: Map<string, string>;
    pj: Map<string, string>;
  }
>();

/**
 * 资源 ID 归一化：分析数据集的 namespaceId 是无连字符的 32 位十六进制，
 * 而 REST 返回带连字符的 UUID，两边必须归一化后才能对上。
 */
function normalizeResourceId(id: string) {
  return id.replace(/-/g, "").toLowerCase();
}

function normalizeNameMap(map: Map<string, string>) {
  const normalized = new Map<string, string>();
  for (const [id, name] of map) normalized.set(normalizeResourceId(id), name);
  return normalized;
}

async function refreshResourceNames(accountId: string, apiToken: string) {
  const cached = resourceNameCache.get(accountId);
  if (cached && Date.now() - cached.at < NAME_CACHE_TTL) return cached;
  const [ns, databases] = await Promise.all([
    getKvNamespaceNames(apiToken, accountId),
    getD1DatabaseNames(apiToken, accountId),
  ]);
  const projects = await getPagesProjectNames(apiToken, accountId);
  const entry = {
    at: Date.now(),
    ns: normalizeNameMap(ns),
    db: normalizeNameMap(databases),
    pj: normalizeNameMap(projects),
  };
  resourceNameCache.set(accountId, entry);
  return entry;
}

function resourceName(accountId: string, scope: SplitScope, id: string) {
  const cached = resourceNameCache.get(accountId);
  const map =
    scope === "ns" ? cached?.ns : scope === "db" ? cached?.db : cached?.pj;
  return map?.get(normalizeResourceId(id)) ?? id;
}

function splitScopeLabel(scope: SplitScope) {
  if (scope === "ns") return "KV 命名空间";
  if (scope === "db") return "D1 数据库";
  return "Pages 项目";
}

/** 从快照中找出拆分视图指标，生成展示用定义 */
async function dynamicMetricDefs(accountId: string): Promise<MetricDef[]> {
  const rows = await db.usageSnapshot.findMany({
    where: { accountId },
    distinct: ["metric"],
    select: { metric: true },
  });
  const defs: MetricDef[] = [];
  for (const row of rows) {
    const parsed = parseSplitMetricId(row.metric);
    if (!parsed) continue;
    const base = METRIC_MAP.get(parsed.base);
    if (!base) continue;
    const name = resourceName(accountId, parsed.scope, parsed.id);
    // 名称表拿不到时（例如 token 缺 KV 读权限）用短 ID，避免标题过长
    const display =
      parsed.scope === "pj" && parsed.id === "__unknown__"
        ? "未知项目"
        : name === parsed.id
          ? `${parsed.id.slice(0, 8)}…`
          : name;
    defs.push({
      ...base,
      id: row.metric,
      label: `${base.label} · ${display}`,
      description: `${base.description}（拆分视图：${splitScopeLabel(
        parsed.scope
      )} ${display}）`,
    });
  }
  defs.sort((a, b) => a.id.localeCompare(b.id));
  return defs;
}

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

    // 扩展数据集（KV / Workers AI / Pages / Durable Objects / Vectorize / 带宽等）
    // 单独请求并单独 try：某数据集不可用时不拖垮主指标
    let extended: ExtendedUsageData | null = null;
    try {
      // Cloudflare 限制查询时间窗（最大约 4w4d，部分数据集更短），
      // 月维度取「月初」与「最近 27 天」中较晚的一个
      const monthFrom = new Date(
        Math.max(utcMonthStart(now).getTime(), now.getTime() - 27 * DAY_MS)
      );
      const res = await queryExtendedUsage(
        apiToken,
        accountId,
        isoDate(weekStart),
        isoDate(now),
        isoDate(monthFrom),
        isoDate(now)
      );
      extended = res?.viewer?.accounts?.[0] ?? null;
      if (!extended) errors.push("扩展指标采集失败：无法读取扩展数据集");
      if (extended) {
        // 名称表（KV namespace / D1 库名）用于拆分视图标签；失败不报错
        await refreshResourceNames(accountId, apiToken);
      }
    } catch (err) {
      errors.push(
        `扩展指标采集失败：${err instanceof Error ? err.message : "未知错误"}`
      );
    }

    let d1Bytes: number | null = null;

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

    if (extended) {
      const addTo = (map: Map<string, number>, date: string, value: number) => {
        if (!date || !Number.isFinite(value)) return;
        map.set(date, (map.get(date) ?? 0) + value);
      };
      const latestDate = (dates: string[]) => [...dates].sort().at(-1) ?? "";

      // KV 操作：按 actionType 拆成 读 / 写 / 删除 / 列举
      const kvByAction = new Map<string, Map<string, number>>();
      for (const row of extended.kvOperations ?? []) {
        const action = String(row.dimensions?.actionType ?? "").toLowerCase();
        const map = kvByAction.get(action) ?? new Map<string, number>();
        addTo(map, row.dimensions?.date, row.sum?.requests ?? 0);
        kvByAction.set(action, map);
      }

      const aiByDate = new Map<string, number>();
      for (const row of extended.aiInference ?? []) {
        addTo(aiByDate, row.dimensions?.date, row.sum?.totalNeurons ?? 0);
      }

      const subrequestsByDate = new Map<string, number>();
      for (const row of extended.workersSubrequests ?? []) {
        addTo(
          subrequestsByDate,
          row.dimensions?.date,
          row.sum?.subrequests ?? 0
        );
      }

      const cacheByDate = new Map<string, number>();
      for (const row of extended.workersCacheRequests ?? []) {
        addTo(cacheByDate, row.dimensions?.date, row.sum?.requests ?? 0);
      }

      const pagesRequestsByDate = new Map<string, number>();
      const pagesErrorsByDate = new Map<string, number>();
      for (const row of extended.pagesFunctions ?? []) {
        addTo(
          pagesRequestsByDate,
          row.dimensions?.date,
          row.sum?.requests ?? 0
        );
        addTo(pagesErrorsByDate, row.dimensions?.date, row.sum?.errors ?? 0);
      }
      const pagesErrorRateByDate = new Map<string, number>();
      for (const [date, requests] of pagesRequestsByDate) {
        const errs = pagesErrorsByDate.get(date) ?? 0;
        pagesErrorRateByDate.set(
          date,
          requests > 0 ? (errs / requests) * 100 : 0
        );
      }

      // 近 7 日滚动错误率：单日尖刺不影响整体判断
      let pagesWeekRequests = 0;
      let pagesWeekErrors = 0;
      for (const row of extended.pagesFunctions ?? []) {
        pagesWeekRequests += row.sum?.requests ?? 0;
        pagesWeekErrors += row.sum?.errors ?? 0;
      }
      await saveDailySnapshot(
        accountId,
        "pages_functions_error_rate_7d",
        pagesWeekRequests > 0
          ? (pagesWeekErrors / pagesWeekRequests) * 100
          : 0,
        now
      );

      const doByDate = new Map<string, number>();
      for (const row of extended.durableObjects ?? []) {
        addTo(doByDate, row.dimensions?.date, row.sum?.requests ?? 0);
      }

      const hyperdriveByDate = new Map<string, number>();
      for (const row of extended.hyperdriveQueries ?? []) {
        addTo(hyperdriveByDate, row.dimensions?.date, row.count ?? 0);
      }

      const dailyExtra: [string, Map<string, number>][] = [
        ["kv_reads", kvByAction.get("read") ?? new Map()],
        ["kv_writes", kvByAction.get("write") ?? new Map()],
        ["kv_deletes", kvByAction.get("delete") ?? new Map()],
        ["kv_lists", kvByAction.get("list") ?? new Map()],
        ["ai_neurons", aiByDate],
        ["workers_subrequests", subrequestsByDate],
        ["workers_cache_requests", cacheByDate],
        ["pages_functions_requests", pagesRequestsByDate],
        ["pages_functions_error_rate", pagesErrorRateByDate],
        ["durable_objects_requests", doByDate],
        ["hyperdrive_queries", hyperdriveByDate],
      ] as [string, Map<string, number>][];
      for (const [metric, map] of dailyExtra) {
        for (const [date, v] of map) {
          await saveDailySnapshot(
            accountId,
            metric,
            v,
            new Date(`${date}T00:00:00Z`)
          );
        }
      }

      // 月度累计指标
      let r2DownBytes = 0;
      let r2UpBytes = 0;
      let buildMinutes = 0;
      let vectorizeQueried = 0;
      let imagesBilled = 0;
      let logpushBytes = 0;
      for (const row of extended.r2Bandwidth ?? []) {
        r2DownBytes += row.sum?.bytesDownload ?? 0;
        r2UpBytes += row.sum?.bytesUpload ?? 0;
      }
      for (const row of extended.workersBuilds ?? []) {
        buildMinutes += row.sum?.buildMinutes ?? 0;
      }
      for (const row of extended.vectorizeQueries ?? []) {
        vectorizeQueried += row.sum?.queriedVectorDimensions ?? 0;
      }
      for (const row of extended.imagesTransformations ?? []) {
        imagesBilled += row.sum?.billableEventCount ?? 0;
      }
      for (const row of extended.logpushUsage ?? []) {
        logpushBytes += row.sum?.billableBytes ?? 0;
      }
      await savePointSnapshot(
        accountId,
        "r2_bandwidth_download",
        r2DownBytes / 1024 ** 3
      );
      await savePointSnapshot(
        accountId,
        "r2_bandwidth_upload",
        r2UpBytes / 1024 ** 3
      );
      await savePointSnapshot(accountId, "workers_builds_minutes", buildMinutes);
      await savePointSnapshot(accountId, "vectorize_queries", vectorizeQueried);
      await savePointSnapshot(
        accountId,
        "images_transformations",
        imagesBilled
      );
      await savePointSnapshot(accountId, "logpush_bytes", logpushBytes / 1024 ** 3);

      // 总量指标：只取最新一天的数据，避免把历史值累加
      function sumOnLatest<T>(
        rows: T[],
        dateOf: (row: T) => string | undefined,
        valueOf: (row: T) => number
      ): number {
        const latest = latestDate(
          rows.map(dateOf).filter((d): d is string => Boolean(d))
        );
        return rows.reduce(
          (acc, row) => (dateOf(row) === latest ? acc + valueOf(row) : acc),
          0
        );
      }

      await savePointSnapshot(
        accountId,
        "kv_storage",
        sumOnLatest(
          extended.kvStorage ?? [],
          (r) => r.dimensions?.date,
          (r) => r.max?.byteCount ?? 0
        ) /
          1024 ** 3
      );
      await savePointSnapshot(
        accountId,
        "vectorize_storage",
        sumOnLatest(
          extended.vectorizeStorage ?? [],
          (r) => r.dimensions?.date,
          (r) => r.max?.storedVectorDimensions ?? 0
        )
      );

      const d1AnalyticsBytes = sumOnLatest(
        extended.d1Storage ?? [],
        (r) => r.dimensions?.date,
        (r) => r.max?.databaseSizeBytes ?? 0
      );
      if (d1AnalyticsBytes > 0) d1Bytes = d1AnalyticsBytes;

      // ---- 拆分视图：KV 按 namespace ----
      const kvActionToMetric: Record<string, string> = {
        read: "kv_reads",
        write: "kv_writes",
        delete: "kv_deletes",
        list: "kv_lists",
      };
      const kvNsMaps = new Map<string, Map<string, number>>();
      for (const row of extended.kvOperations ?? []) {
        const nsId = row.dimensions?.namespaceId;
        const date = row.dimensions?.date;
        const action = String(row.dimensions?.actionType ?? "").toLowerCase();
        if (!nsId || !date || !kvActionToMetric[action]) continue;
        const key = `${action}${SPLIT_SEP}${nsId}`;
        const map = kvNsMaps.get(key) ?? new Map<string, number>();
        addTo(map, date, row.sum?.requests ?? 0);
        kvNsMaps.set(key, map);
      }
      for (const [key, map] of kvNsMaps) {
        const [action, nsId] = key.split(SPLIT_SEP);
        const metricId = splitMetricId(kvActionToMetric[action], "ns", nsId);
        for (const [date, v] of map) {
          await saveDailySnapshot(
            accountId,
            metricId,
            v,
            new Date(`${date}T00:00:00Z`)
          );
        }
      }

      // ---- 拆分视图：D1 按数据库 ----
      const d1ReadByDb = new Map<string, Map<string, number>>();
      const d1WrittenByDb = new Map<string, Map<string, number>>();
      for (const row of extended.d1Queries ?? []) {
        const dbId = row.dimensions?.databaseId;
        const date = row.dimensions?.date;
        if (!dbId || !date) continue;
        const readMap = d1ReadByDb.get(dbId) ?? new Map<string, number>();
        addTo(readMap, date, row.sum?.rowsRead ?? 0);
        d1ReadByDb.set(dbId, readMap);
        const writtenMap = d1WrittenByDb.get(dbId) ?? new Map<string, number>();
        addTo(writtenMap, date, row.sum?.rowsWritten ?? 0);
        d1WrittenByDb.set(dbId, writtenMap);
      }
      for (const [dbId, map] of d1ReadByDb) {
        const metricId = splitMetricId("d1_rows_read", "db", dbId);
        for (const [date, v] of map) {
          await saveDailySnapshot(
            accountId,
            metricId,
            v,
            new Date(`${date}T00:00:00Z`)
          );
        }
      }
      for (const [dbId, map] of d1WrittenByDb) {
        const metricId = splitMetricId("d1_rows_written", "db", dbId);
        for (const [date, v] of map) {
          await saveDailySnapshot(
            accountId,
            metricId,
            v,
            new Date(`${date}T00:00:00Z`)
          );
        }
      }

      const d1StorageRows = extended.d1Storage ?? [];
      const d1LatestDate = latestDate(
        d1StorageRows
          .map((r) => r.dimensions?.date)
          .filter((d): d is string => Boolean(d))
      );
      const d1StorageByDb = new Map<string, number>();
      for (const row of d1StorageRows) {
        if (row.dimensions?.date !== d1LatestDate) continue;
        const dbId = row.dimensions?.databaseId;
        if (!dbId) continue;
        d1StorageByDb.set(
          dbId,
          Math.max(d1StorageByDb.get(dbId) ?? 0, row.max?.databaseSizeBytes ?? 0)
        );
      }
      for (const [dbId, bytes] of d1StorageByDb) {
        await savePointSnapshot(
          accountId,
          splitMetricId("d1_storage", "db", dbId),
          bytes / 1024 ** 3
        );
      }

      // ---- 拆分视图：Pages Functions 按项目 ----
      const pagesByProject = new Map<
        string,
        Map<string, { requests: number; errors: number }>
      >();
      for (const row of extended.pagesFunctions ?? []) {
        const scriptName = row.dimensions?.scriptName;
        const date = row.dimensions?.date;
        if (!scriptName || !date) continue;
        const projectId = pagesProjectId(scriptName);
        const byDate =
          pagesByProject.get(projectId) ??
          new Map<string, { requests: number; errors: number }>();
        const current = byDate.get(date) ?? { requests: 0, errors: 0 };
        current.requests += row.sum?.requests ?? 0;
        current.errors += row.sum?.errors ?? 0;
        byDate.set(date, current);
        pagesByProject.set(projectId, byDate);
      }
      for (const [projectId, byDate] of pagesByProject) {
        for (const [date, value] of byDate) {
          const day = new Date(`${date}T00:00:00Z`);
          await saveDailySnapshot(
            accountId,
            splitMetricId("pages_functions_requests", "pj", projectId),
            value.requests,
            day
          );
          if (value.requests > 0) {
            await saveDailySnapshot(
              accountId,
              splitMetricId("pages_functions_error_rate", "pj", projectId),
              (value.errors / value.requests) * 100,
              day
            );
          }
        }
      }
    }

    // D1 存储：分析数据集拿不到时回退 REST（需 D1:Read 权限）
    if (d1Bytes === null) {
      d1Bytes = await getD1StorageBytes(apiToken, accountId);
      if (d1Bytes === null) {
        errors.push("D1 存储用量获取失败（缺少 D1:Read 权限或账号无 D1）");
      }
    }
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
  /** 指标基准值；未列出的指标按配额比例生成模拟值 */
  base: Record<string, number>;
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

  const quotaMap = await getQuotaMap(spec.accountId);
  const baseValue = (metric: string) =>
    spec.base[metric] ??
    Math.round((quotaMap.get(metric) ?? 1) * (0.15 + Math.random() * 0.3));

  // 近 7 日每日指标历史（不含今日）：全部日维度指标 + R2 Class A/B
  const dailyBase: [string, number][] = [
    ...METRIC_REGISTRY.filter((m) => m.period === "day").map(
      (m) => [m.id, baseValue(m.id)] as [string, number]
    ),
    ["r2_class_a", baseValue("r2_class_a")],
    ["r2_class_b", baseValue("r2_class_b")],
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
  // 月度 / 总量指标：每个指标记一个点
  for (const def of METRIC_REGISTRY) {
    if (def.period === "day") continue;
    await savePointSnapshot(spec.accountId, def.id, baseValue(def.id));
  }

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

  // 其余内置指标（KV / AI / Pages / Durable Objects / 构建 / 带宽等）同步模拟增长
  const handled = new Set([
    "workers_requests",
    "d1_rows_read",
    "d1_rows_written",
    "r2_class_a",
    "r2_class_b",
    "r2_storage",
    "d1_storage",
  ]);
  for (const def of METRIC_REGISTRY) {
    if (handled.has(def.id)) continue;
    if (def.period === "day") {
      await saveDailySnapshot(
        accountId,
        def.id,
        Math.max(0, walk(def.id, 0.2, 2)),
        now
      );
    } else {
      await savePointSnapshot(accountId, def.id, Math.max(0, walk(def.id, -1, 1.5)));
    }
  }

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
  accountId: string,
  extraMetricIds: string[] = []
): Promise<Map<string, { used: number; capturedAt: Date }>> {
  const metrics = new Set([
    ...METRIC_REGISTRY.map((m) => m.id),
    ...extraMetricIds,
  ]);
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
  const splitDefs = await dynamicMetricDefs(accountId);
  const latest = await latestSnapshotMap(
    accountId,
    splitDefs.map((d) => d.id)
  );

  const metrics: MetricStatus[] = [];

  for (const def of [...METRIC_REGISTRY, ...splitDefs]) {
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

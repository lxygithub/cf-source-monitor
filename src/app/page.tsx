"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleCheck, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MonitorHeader } from "@/components/monitor/monitor-header";
import { MonitorFooter } from "@/components/monitor/monitor-footer";
import { Onboarding } from "@/components/monitor/onboarding";
import { MetricCard } from "@/components/monitor/metric-card";
import {
  CATEGORY_ORDER,
  categoryMeta,
} from "@/components/monitor/metric-categories";
import { TrendDialog } from "@/components/monitor/trend-dialog";
import { AccountManagerDialog } from "@/components/monitor/account-manager-dialog";
import { CustomMetricDialog } from "@/components/monitor/custom-metric-dialog";
import { QuotaDialog } from "@/components/monitor/quota-dialog";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AccountGroup, MetricStatus, MonitorStatus } from "@/lib/monitor/types";

const AUTO_REFRESH_MS = 60_000;

export default function MonitorPage() {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [view, setView] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [accountsOpen, setAccountsOpen] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState<MetricStatus | null>(null);
  const [createAccountId, setCreateAccountId] = useState<string | null>(null);
  const [quotaMetric, setQuotaMetric] = useState<MetricStatus | null>(null);
  const [trendMetric, setTrendMetric] = useState<MetricStatus | null>(null);

  const viewRef = useRef(view);
  viewRef.current = view;
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  const fetchStatus = useCallback(async (viewOverride?: string) => {
    const v = viewOverride ?? viewRef.current;
    try {
      const res = await fetch(
        `/api/monitor/status?view=${encodeURIComponent(v)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = (await res.json()) as MonitorStatus;
        // 所选账号已被删除时回退到全部视图
        if (v !== "all" && !data.accountList.some((a) => a.id === v)) {
          viewRef.current = "all";
          setView("all");
          return fetchStatus("all");
        }
        setStatus(data);
      }
    } catch {
      // 静默失败，保留上次状态
    }
  }, []);

  useEffect(() => {
    // 恢复上次选择的账号视图
    const saved = window.localStorage.getItem("cf-monitor:view");
    if (saved) {
      viewRef.current = saved;
      setView(saved);
    }
    void fetchStatus(saved ?? undefined).finally(() => setLoading(false));
  }, [fetchStatus]);

  const handleToggleFavorite = useCallback(
    async (m: MetricStatus) => {
      try {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountDbId: m.accountDbId,
            metric: m.metric,
            favorite: !m.favorite,
          }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (!data.ok) {
          toast.error(data.error ?? "操作失败");
          return;
        }
        toast.success(data.ok && m.favorite ? "已取消收藏" : "已收藏，置顶显示");
        await fetchStatus();
      } catch {
        toast.error("网络错误，请稍后重试");
      }
    },
    [fetchStatus]
  );

  const handleRefresh = useCallback(async (silent = false) => {
    if (refreshingRef.current) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/monitor/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: viewRef.current === "all" ? undefined : viewRef.current,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        errors?: string[];
        refreshed?: number;
      };
      if (!data.ok) {
        toast.error(data.errors?.[0] ?? "刷新失败");
      } else if (data.errors && data.errors.length > 0) {
        toast.warning(data.errors[0]);
      } else if (!silent) {
        toast.success("用量已刷新");
      }
      await fetchStatus();
    } catch {
      if (!silent) toast.error("网络错误，请稍后重试");
    } finally {
      setRefreshing(false);
    }
  }, [fetchStatus]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh || !status || status.accountCount === 0) return;
    const timer = setInterval(() => {
      void handleRefresh(true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, status?.accountCount, handleRefresh, status]);

  const handleSeedDemo = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "演示数据生成失败");
        return;
      }
      toast.success("已添加演示账号，数据为模拟生成");
      await fetchStatus();
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSeeding(false);
    }
  }, [fetchStatus]);

  const handleDeleteCustom = useCallback(
    async (m: MetricStatus) => {
      if (!m.customId) return;
      try {
        const res = await fetch(`/api/custom-metrics/${m.customId}`, {
          method: "DELETE",
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (!data.ok) {
          toast.error(data.error ?? "删除失败");
          return;
        }
        toast.success(`已删除「${m.label}」`);
        await fetchStatus();
      } catch {
        toast.error("网络错误，请稍后重试");
      }
    },
    [fetchStatus]
  );

  const openAddCustom = (accountId: string) => {
    setEditingCustom(null);
    setCreateAccountId(accountId);
    setCustomDialogOpen(true);
  };

  const hasAccounts = (status?.accountCount ?? 0) > 0;
  const groups = status?.accounts ?? [];
  const multi = groups.length > 1;

  const alertMetrics =
    status?.accounts
      .flatMap((g) => g.metrics)
      .filter((m) => m.level === "danger" || m.level === "over") ?? [];
  const warningMetrics =
    status?.accounts
      .flatMap((g) => g.metrics)
      .filter((m) => m.level === "warning") ?? [];
  const summary = status?.summary;

  return (
    <div className="flex min-h-screen flex-col">
      <MonitorHeader
        accounts={status?.accountList ?? []}
        accountCount={status?.accountCount ?? 0}
        view={view}
        lastRefreshAt={status?.lastRefreshAt ?? null}
        refreshing={refreshing}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onViewChange={(v) => {
          viewRef.current = v;
          setView(v);
          window.localStorage.setItem("cf-monitor:view", v);
          void fetchStatus(v);
        }}
        onRefresh={() => void handleRefresh()}
        onOpenAccounts={() => setAccountsOpen(true)}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : !hasAccounts ? (
          <Onboarding
            onOpenAccounts={() => setAccountsOpen(true)}
            onSeedDemo={handleSeedDemo}
            seeding={seeding}
          />
        ) : (
          <div className="space-y-6">
            {/* 概览统计 */}
            {summary && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="监控指标" value={summary.total} dot="bg-orange-500" />
                <StatCard label="正常" value={summary.ok} dot="bg-emerald-500" />
                <StatCard
                  label="接近限额"
                  value={summary.warning}
                  dot="bg-amber-500"
                />
                <StatCard
                  label="需处理"
                  value={summary.danger + summary.over}
                  dot="bg-red-500"
                />
              </div>
            )}

            {/* 告警横幅 */}
            {alertMetrics.length > 0 ? (
              <AlertBanner variant="danger" metrics={alertMetrics} multi={multi} />
            ) : warningMetrics.length > 0 ? (
              <AlertBanner variant="warning" metrics={warningMetrics} multi={multi} />
            ) : null}

            {/* 按账号分组渲染 */}
            {groups.map((group) => (
              <AccountSection
                key={group.id}
                group={group}
                showHeader={multi}
                onEditQuota={setQuotaMetric}
                onShowTrend={setTrendMetric}
                onEditCustom={(m) => {
                  setEditingCustom(m);
                  setCreateAccountId(null);
                  setCustomDialogOpen(true);
                }}
                onUpdateUsage={(m) => {
                  setEditingCustom(m);
                  setCreateAccountId(null);
                  setCustomDialogOpen(true);
                }}
                onDeleteCustom={(m) => void handleDeleteCustom(m)}
                onAddCustom={() => openAddCustom(group.accountId)}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        )}
      </main>

      <MonitorFooter />

      {/* 弹窗 */}
      <AccountManagerDialog
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        onChanged={fetchStatus}
      />
      <CustomMetricDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        editing={editingCustom}
        createAccountId={createAccountId}
        onSaved={fetchStatus}
      />
      <QuotaDialog
        open={quotaMetric !== null}
        onOpenChange={(open) => {
          if (!open) setQuotaMetric(null);
        }}
        metric={quotaMetric}
        onSaved={fetchStatus}
      />
      <TrendDialog
        open={trendMetric !== null}
        onOpenChange={(open) => {
          if (!open) setTrendMetric(null);
        }}
        metric={trendMetric}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  dot,
}: {
  label: string;
  value: number;
  dot: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <span className={`size-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="leading-tight">
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

interface AccountSectionProps {
  group: AccountGroup;
  showHeader: boolean;
  onEditQuota: (m: MetricStatus) => void;
  onShowTrend: (m: MetricStatus) => void;
  onEditCustom: (m: MetricStatus) => void;
  onUpdateUsage: (m: MetricStatus) => void;
  onDeleteCustom: (m: MetricStatus) => void;
  onAddCustom: () => void;
  onToggleFavorite: (m: MetricStatus) => void;
}

/** 内置指标按分类分组，顺序固定；未列入 CATEGORY_ORDER 的分类排在后面 */
function categorySections(
  metrics: MetricStatus[]
): [string, MetricStatus[]][] {
  const grouped = new Map<string, MetricStatus[]>();
  for (const m of metrics) {
    const list = grouped.get(m.category);
    if (list) list.push(m);
    else grouped.set(m.category, [m]);
  }
  const ordered: [string, MetricStatus[]][] = [];
  for (const key of CATEGORY_ORDER) {
    const list = grouped.get(key);
    if (list && list.length > 0) {
      ordered.push([key, list]);
      grouped.delete(key);
    }
  }
  for (const [key, list] of grouped) ordered.push([key, list]);
  return ordered;
}

interface MetricSectionProps {
  category: string;
  metrics: MetricStatus[];
  onEditQuota: (m: MetricStatus) => void;
  onShowTrend: (m: MetricStatus) => void;
  onToggleFavorite: (m: MetricStatus) => void;
}

/** 一个分类的指标分组：色条 + 标题 + 告警计数 + 卡片网格 */
function MetricSection({
  category,
  metrics,
  onEditQuota,
  onShowTrend,
  onToggleFavorite,
}: MetricSectionProps) {
  const meta = categoryMeta(category);
  const SectionIcon = meta.icon;
  const over = metrics.filter(
    (m) => m.level === "danger" || m.level === "over"
  ).length;
  const warn = metrics.filter((m) => m.level === "warning").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("h-4 w-1 rounded-full", meta.bar)} />
        <SectionIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{meta.label}</h3>
        <span className="text-xs text-muted-foreground">{metrics.length}</span>
        {over > 0 && (
          <Badge className="border-transparent bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400">
            {over} 需处理
          </Badge>
        )}
        {over === 0 && warn > 0 && (
          <Badge className="border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
            {warn} 接近限额
          </Badge>
        )}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
          {meta.hint}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {metrics.map((m) => (
          <MetricCard
            key={m.metric}
            status={m}
            onEditQuota={onEditQuota}
            onShowTrend={onShowTrend}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </div>
  );
}

function AccountSection({
  group,
  showHeader,
  onEditQuota,
  onShowTrend,
  onEditCustom,
  onUpdateUsage,
  onDeleteCustom,
  onAddCustom,
  onToggleFavorite,
}: AccountSectionProps) {
  const favorites = group.builtin.filter((m) => m.favorite);

  return (
    <section aria-label={`账号 ${group.name}`} className="space-y-3">
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 first:border-t-0 first:pt-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{group.name}</h2>
            {group.demo && (
              <Badge className="border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                演示数据
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            最近刷新：{formatTime(group.lastRefreshAt)}
          </span>
        </div>
      )}

      {/* 收藏：置顶单独成组 */}
      {favorites.length > 0 && (
        <MetricSection
          category="favorite"
          metrics={favorites}
          onEditQuota={onEditQuota}
          onShowTrend={onShowTrend}
          onToggleFavorite={onToggleFavorite}
        />
      )}

      {/* 自动采集指标：按分类分组（收藏的已在上面单独展示） */}
      <div className="space-y-6">
        {categorySections(group.builtin.filter((m) => !m.favorite)).map(
          ([key, list]) => (
            <MetricSection
              key={key}
              category={key}
              metrics={list}
              onEditQuota={onEditQuota}
              onShowTrend={onShowTrend}
              onToggleFavorite={onToggleFavorite}
            />
          )
        )}
      </div>

      {/* 自定义指标 */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-xs text-muted-foreground">
          {categoryMeta("custom").label}（手动记录）
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={onAddCustom}
          aria-label={`为 ${group.name} 添加自定义指标`}
        >
          <Plus className="size-4" />
          添加指标
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {group.custom.map((m) => (
          <MetricCard
            key={m.metric}
            status={m}
            onShowTrend={onShowTrend}
            onEditCustom={onEditCustom}
            onUpdateUsage={onUpdateUsage}
            onDeleteCustom={onDeleteCustom}
          />
        ))}
        {group.custom.length === 0 && (
          <button
            type="button"
            onClick={onAddCustom}
            className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-orange-300 hover:text-foreground"
          >
            <Plus className="size-5" />
            添加 KV / Pages 等手动指标
          </button>
        )}
      </div>
    </section>
  );
}

function AlertBanner({
  variant,
  metrics,
  multi,
}: {
  variant: "warning" | "danger";
  metrics: MetricStatus[];
  multi: boolean;
}) {
  const isDanger = variant === "danger";
  const Icon = isDanger ? TriangleAlert : AlertTriangle;
  const names = metrics
    .map((m) => (multi ? `${m.accountName} · ${m.label}` : m.label))
    .join("、");
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border p-4 ${
        isDanger
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
      }`}
    >
      <Icon
        className={`mt-0.5 size-5 shrink-0 ${isDanger ? "text-red-500" : "text-amber-500"}`}
      />
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {isDanger
            ? "以下资源额度紧张或已超限："
            : "以下资源已接近告警阈值（≥60%）："}
        </p>
        <p className="mt-0.5 opacity-90">{names}</p>
      </div>
      {isDanger ? (
        <TriangleAlert className="ml-auto hidden size-4 shrink-0 sm:block" aria-hidden />
      ) : (
        <CircleCheck className="ml-auto hidden size-4 shrink-0 sm:block" aria-hidden />
      )}
    </div>
  );
}

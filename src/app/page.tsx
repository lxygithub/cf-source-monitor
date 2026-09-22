"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleCheck, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MonitorHeader } from "@/components/monitor/monitor-header";
import { MonitorFooter } from "@/components/monitor/monitor-footer";
import { Onboarding } from "@/components/monitor/onboarding";
import { MetricCard } from "@/components/monitor/metric-card";
import { TrendDialog } from "@/components/monitor/trend-dialog";
import { SettingsDialog } from "@/components/monitor/settings-dialog";
import { CustomMetricDialog } from "@/components/monitor/custom-metric-dialog";
import { QuotaDialog } from "@/components/monitor/quota-dialog";
import type { MetricStatus, MonitorStatus } from "@/lib/monitor/types";

const AUTO_REFRESH_MS = 60_000;

export default function MonitorPage() {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState<MetricStatus | null>(null);
  const [quotaMetric, setQuotaMetric] = useState<MetricStatus | null>(null);
  const [trendMetric, setTrendMetric] = useState<MetricStatus | null>(null);

  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor/status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as MonitorStatus);
    } catch {
      // 静默失败，保留上次状态
    }
  }, []);

  useEffect(() => {
    void fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  const handleRefresh = useCallback(
    async (silent = false) => {
      if (refreshingRef.current) return;
      setRefreshing(true);
      try {
        const res = await fetch("/api/monitor/refresh", { method: "POST" });
        const data = (await res.json()) as {
          ok: boolean;
          errors?: string[];
          status?: MonitorStatus;
        };
        if (data.status) setStatus(data.status);
        if (!data.ok) {
          toast.error(data.errors?.[0] ?? "刷新失败");
        } else if (data.errors && data.errors.length > 0) {
          toast.warning(data.errors[0]);
        } else if (!silent) {
          toast.success("用量已刷新");
        }
      } catch {
        if (!silent) toast.error("网络错误，请稍后重试");
      } finally {
        setRefreshing(false);
      }
    },
    []
  );

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh || !status?.config.configured) return;
    const timer = setInterval(() => {
      void handleRefresh(true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, status?.config.configured, handleRefresh]);

  const handleSeedDemo = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "演示数据生成失败");
        return;
      }
      toast.success("已进入演示模式，数据为模拟生成");
      await fetchStatus();
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSeeding(false);
    }
  }, [fetchStatus]);

  const handleClearAll = useCallback(async () => {
    await fetchStatus();
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

  const openAddCustom = () => {
    setEditingCustom(null);
    setCustomDialogOpen(true);
  };

  const configured = status?.config.configured ?? false;
  const builtinMetrics = status?.metrics.filter((m) => !m.custom) ?? [];
  const customMetrics = status?.metrics.filter((m) => m.custom) ?? [];
  const summary = status?.summary;

  const alertMetrics =
    status?.metrics.filter(
      (m) => m.level === "danger" || m.level === "over"
    ) ?? [];
  const warningMetrics =
    status?.metrics.filter((m) => m.level === "warning") ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <MonitorHeader
        config={status?.config ?? null}
        lastRefreshAt={status?.lastRefreshAt ?? null}
        refreshing={refreshing}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => void handleRefresh()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : !configured ? (
          <Onboarding
            onOpenSettings={() => setSettingsOpen(true)}
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
              <AlertBanner
                variant="danger"
                metrics={alertMetrics}
              />
            ) : warningMetrics.length > 0 ? (
              <AlertBanner variant="warning" metrics={warningMetrics} />
            ) : null}

            {/* 内置指标 */}
            <section aria-label="自动采集指标">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">
                  自动采集指标（Cloudflare API）
                </h2>
                {status?.config.demo && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    演示模式下数据为模拟生成
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {builtinMetrics.map((m) => (
                  <MetricCard
                    key={m.metric}
                    status={m}
                    onEditQuota={setQuotaMetric}
                    onShowTrend={setTrendMetric}
                  />
                ))}
              </div>
            </section>

            {/* 自定义指标 */}
            <section aria-label="自定义指标">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">
                  自定义指标（手动记录）
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openAddCustom}
                  aria-label="添加自定义指标"
                >
                  <Plus className="size-4" />
                  添加指标
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {customMetrics.map((m) => (
                  <MetricCard
                    key={m.metric}
                    status={m}
                    onShowTrend={setTrendMetric}
                    onEditCustom={(metric) => {
                      setEditingCustom(metric);
                      setCustomDialogOpen(true);
                    }}
                    onUpdateUsage={(metric) => {
                      setEditingCustom(metric);
                      setCustomDialogOpen(true);
                    }}
                    onDeleteCustom={(metric) => void handleDeleteCustom(metric)}
                  />
                ))}
                {customMetrics.length === 0 && (
                  <button
                    type="button"
                    onClick={openAddCustom}
                    className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-orange-300 hover:text-foreground"
                  >
                    <Plus className="size-5" />
                    添加 KV / Pages 等手动指标
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <MonitorFooter />

      {/* 弹窗 */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={status?.config ?? null}
        onSaved={async () => {
          await fetchStatus();
          await handleRefresh(true);
        }}
        onCleared={handleClearAll}
      />
      <CustomMetricDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        editing={editingCustom}
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

function AlertBanner({
  variant,
  metrics,
}: {
  variant: "warning" | "danger";
  metrics: MetricStatus[];
}) {
  const isDanger = variant === "danger";
  const Icon = isDanger ? TriangleAlert : AlertTriangle;
  const names = metrics.map((m) => m.label).join("、");
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border p-4 ${
        isDanger
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
      }`}
    >
      <Icon className={`mt-0.5 size-5 shrink-0 ${isDanger ? "text-red-500" : "text-amber-500"}`} />
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

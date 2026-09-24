"use client";

import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  PenLine,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { categoryMeta } from "./metric-categories";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sparkline } from "./sparkline";
import { PERIOD_LABEL, formatNumber, formatPercent } from "@/lib/format";
import type { MetricStatus, UsageLevel } from "@/lib/monitor/types";
import { cn } from "@/lib/utils";

const LEVEL_STYLE: Record<
  UsageLevel,
  { bar: string; badge: string; label: string }
> = {
  ok: {
    bar: "bg-emerald-500",
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
    label: "正常",
  },
  warning: {
    bar: "bg-amber-500",
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
    label: "接近限额",
  },
  danger: {
    bar: "bg-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400",
    label: "额度紧张",
  },
  over: {
    bar: "bg-red-600",
    badge: "bg-red-600 text-white",
    label: "已超限",
  },
  nodata: {
    bar: "bg-muted-foreground/40",
    badge: "bg-muted text-muted-foreground",
    label: "暂无数据",
  },
};

interface MetricCardProps {
  status: MetricStatus;
  onEditQuota?: (m: MetricStatus) => void;
  onEditCustom?: (m: MetricStatus) => void;
  onDeleteCustom?: (m: MetricStatus) => void;
  onUpdateUsage?: (m: MetricStatus) => void;
  onShowTrend: (m: MetricStatus) => void;
}

export function MetricCard({
  status,
  onEditQuota,
  onEditCustom,
  onDeleteCustom,
  onUpdateUsage,
  onShowTrend,
}: MetricCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const level = LEVEL_STYLE[status.level];
  const cat = categoryMeta(status.category);
  const Icon = cat.icon;
  const percent = status.percent ?? 0;
  const barPct = Math.min(Math.max(percent, 0), 100);

  return (
    <Card className="group relative overflow-hidden py-0 transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        {/* 标题行 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                cat.chip
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">
                {status.label}
              </p>
              <p className="text-[11px] leading-tight text-muted-foreground">
                {PERIOD_LABEL[status.period]}额度 · {status.unit}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {status.custom ? (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    aria-label={`${status.label} 更多操作`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem onSelect={() => onUpdateUsage?.(status)}>
                    <PenLine className="size-4" /> 记录用量
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onEditCustom?.(status)}>
                    <Pencil className="size-4" /> 编辑指标
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onDeleteCustom?.(status)}
                  >
                    <Trash2 className="size-4" /> 删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => onEditQuota?.(status)}
                aria-label={`调整${status.label}配额`}
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* 用量 */}
        <div className="flex items-end justify-between gap-2">
          <p className="truncate text-2xl font-semibold tabular-nums tracking-tight">
            {status.used === null ? (
              <span className="text-muted-foreground">--</span>
            ) : (
              formatNumber(status.used)
            )}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {status.unit}
            </span>
          </p>
          <Badge className={cn("shrink-0 border-transparent", level.badge)}>
            {status.used === null ? level.label : formatPercent(percent)}
          </Badge>
        </div>

        {/* 进度条 */}
        <Progress
          value={barPct}
          aria-label={`${status.label} 使用 ${formatPercent(percent)}`}
          className="h-2 bg-muted"
        />

        {/* 配额信息 */}
        <p className="text-xs text-muted-foreground">
          配额 {formatNumber(status.quota)} {status.unit}
          {status.remaining !== null && (
            <>
              {" · "}
              剩余{" "}
              <span
                className={cn(
                  "font-medium",
                  status.remaining <= 0
                    ? "text-red-600 dark:text-red-400"
                    : status.level === "danger" || status.level === "over"
                      ? "text-red-600 dark:text-red-400"
                      : status.level === "warning"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {formatNumber(status.remaining)}
              </span>
            </>
          )}
        </p>

        {/* 趋势 */}
        <button
          type="button"
          onClick={() => onShowTrend(status)}
          className="mt-auto flex w-full items-center gap-2 rounded-md pt-1 text-left outline-offset-2 transition-colors focus-visible:outline"
          aria-label={`查看${status.label}近 7 日趋势`}
        >
          <Sparkline history={status.history} className="flex-1" />
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            <TrendingUp className="size-3" />
            近 7 日
          </span>
        </button>
      </CardContent>
    </Card>
  );
}

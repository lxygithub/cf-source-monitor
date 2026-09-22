"use client";

import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

interface SparklineProps {
  history: { date: string; used: number }[];
  className?: string;
}

/** 近 7 日用量迷你柱状图 */
export function Sparkline({ history, className }: SparklineProps) {
  const points = history.slice(-7);
  if (points.length < 2) {
    return (
      <div
        className={cn(
          "flex h-10 items-center text-xs text-muted-foreground",
          className
        )}
      >
        暂无趋势数据
      </div>
    );
  }
  const max = Math.max(...points.map((p) => p.used), 1);

  return (
    <div className={cn("flex h-10 items-end gap-1", className)}>
      {points.map((p) => {
        const pct = Math.max((p.used / max) * 100, 4);
        return (
          <div
            key={p.date}
            className="group relative flex h-full flex-1 cursor-default items-end"
            title={`${p.date.slice(5)}：${formatNumber(p.used)}`}
          >
            <div
              className="w-full rounded-sm bg-orange-400/60 transition-colors group-hover:bg-orange-500 dark:bg-orange-500/50 dark:group-hover:bg-orange-400"
              style={{ height: `${pct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

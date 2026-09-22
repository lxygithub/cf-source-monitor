"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PERIOD_LABEL, formatNumber } from "@/lib/format";
import type { MetricStatus } from "@/lib/monitor/types";

interface TrendDialogProps {
  metric: MetricStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 指标近 7 日用量趋势详情 */
export function TrendDialog({ metric, open, onOpenChange }: TrendDialogProps) {
  if (!metric) return null;
  const data = metric.history.slice(-7).map((h) => ({
    ...h,
    label: h.date.slice(5).replace("-", "/"),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {metric.label} · 近 7 日趋势
          </DialogTitle>
          <DialogDescription>
            {PERIOD_LABEL[metric.period]}额度 {formatNumber(metric.quota)}{" "}
            {metric.unit}，快照按天聚合（每日取最后一次记录）
          </DialogDescription>
        </DialogHeader>

        {data.length < 2 ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            快照数据不足，继续使用并在每日刷新后将逐渐形成趋势曲线
          </div>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => formatNumber(v)}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  formatter={(value) => [
                    `${formatNumber(Number(value))} ${metric.unit}`,
                    "用量",
                  ]}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                {metric.period === "total" && (
                  <ReferenceLine
                    y={metric.quota}
                    stroke="#ef4444"
                    strokeDasharray="6 3"
                    label={{ value: "配额", position: "insideTopRight", fontSize: 11, fill: "#ef4444" }}
                  />
                )}
                <Bar dataKey="used" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          每日额度按 UTC 时间 00:00 重置；月度 / 总量指标为每次刷新记录的即时值。
        </p>
      </DialogContent>
    </Dialog>
  );
}

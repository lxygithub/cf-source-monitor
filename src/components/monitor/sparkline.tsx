"use client";

import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

interface SparklineProps {
  history: { date: string; used: number }[];
  className?: string;
}

/** 近 7 日用量迷你折线图 */
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

  const width = 100;
  const height = 40;
  const padX = 2;
  const padY = 5;
  const max = Math.max(...points.map((p) => p.used));
  const min = Math.min(...points.map((p) => p.used));
  const range = max - min || Math.max(max, 1);
  const step = (width - padX * 2) / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = padX + i * step;
    const y = height - padY - ((p.used - min) / range) * (height - padY * 2);
    return { x, y, point: p };
  });
  const line = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const area = `${padX},${height - padY} ${line} ${(width - padX).toFixed(2)},${height - padY}`;

  return (
    <div className={cn("h-10 w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label="近 7 日用量折线图"
      >
        <polygon points={area} fill="#fb923c" opacity={0.16} />
        <polyline
          points={line}
          fill="none"
          stroke="#f97316"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((c, i) => (
          <rect
            key={c.point.date}
            x={c.x - step / 2}
            y={0}
            width={i === 0 || i === coords.length - 1 ? step / 2 : step}
            height={height}
            fill="transparent"
          >
            <title>{`${c.point.date.slice(5)}：${formatNumber(c.point.used)}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

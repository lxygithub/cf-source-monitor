// 内置监控指标注册表
// 配额默认值参考 Cloudflare Free 套餐（2025），可在前端按需修改

import type { MetricDef, BuiltinMetricId } from "./types";

export const METRIC_REGISTRY: MetricDef[] = [
  {
    id: "workers_requests",
    label: "Workers 请求次数",
    description: "所有 Workers 脚本当日累计请求数",
    unit: "次",
    period: "day",
    defaultQuota: 100_000,
    category: "workers",
  },
  {
    id: "r2_storage",
    label: "R2 存储用量",
    description: "对象数据 + 元数据的当前存储总量",
    unit: "GB",
    period: "total",
    defaultQuota: 10,
    category: "storage",
  },
  {
    id: "r2_class_a",
    label: "R2 Class A 操作",
    description: "写 / 列举类操作（PutObject、ListObjects 等）",
    unit: "次",
    period: "month",
    defaultQuota: 1_000_000,
    category: "storage",
  },
  {
    id: "r2_class_b",
    label: "R2 Class B 操作",
    description: "读类操作（GetObject、HeadObject 等）",
    unit: "次",
    period: "month",
    defaultQuota: 10_000_000,
    category: "storage",
  },
  {
    id: "d1_rows_read",
    label: "D1 读取行数",
    description: "当日所有 D1 数据库累计读取行数",
    unit: "行",
    period: "day",
    defaultQuota: 5_000_000,
    category: "database",
  },
  {
    id: "d1_rows_written",
    label: "D1 写入行数",
    description: "当日所有 D1 数据库累计写入行数",
    unit: "行",
    period: "day",
    defaultQuota: 100_000,
    category: "database",
  },
  {
    id: "d1_storage",
    label: "D1 存储用量",
    description: "所有 D1 数据库文件大小总和",
    unit: "GB",
    period: "total",
    defaultQuota: 5,
    category: "database",
  },
];

export const METRIC_MAP = new Map<string, MetricDef>(
  METRIC_REGISTRY.map((m) => [m.id, m])
);

/** 警告阈值（百分比），达到即提示"接近限额" */
export const WARNING_THRESHOLD = 60;
/** 危险阈值（百分比），达到即提示"额度紧张" */
export const DANGER_THRESHOLD = 85;

export function getLevel(percent: number | null) {
  if (percent === null) return "nodata" as const;
  if (percent >= 100) return "over" as const;
  if (percent >= DANGER_THRESHOLD) return "danger" as const;
  if (percent >= WARNING_THRESHOLD) return "warning" as const;
  return "ok" as const;
}

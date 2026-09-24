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
    id: "workers_subrequests",
    label: "Workers 子请求数",
    description:
      "当日子请求（fetch 到其他服务）总数。免费套餐单次调用上限 50 个子请求，此项为总量观测",
    unit: "次",
    period: "day",
    defaultQuota: 1_000_000,
    category: "workers",
  },
  {
    id: "workers_cache_requests",
    label: "Workers 缓存命中请求",
    description: "当日命中 Workers 缓存的请求数（已包含在总请求数内，仅作观测）",
    unit: "次",
    period: "day",
    defaultQuota: 100_000,
    category: "workers",
  },
  {
    id: "workers_builds_minutes",
    label: "Workers 构建时长",
    description: "当月 Workers Builds 构建分钟数（免费额度以套餐为准，可自行调整）",
    unit: "分钟",
    period: "month",
    defaultQuota: 3_000,
    category: "workers",
  },
  {
    id: "pages_functions_requests",
    label: "Pages Functions 请求",
    description: "当日 Pages Functions 请求数",
    unit: "次",
    period: "day",
    defaultQuota: 100_000,
    category: "workers",
  },
  {
    id: "pages_functions_error_rate",
    label: "Pages Functions 错误率",
    description: "当日 Pages Functions 错误率（errors / requests × 100）",
    unit: "%",
    period: "day",
    defaultQuota: 2,
    category: "workers",
  },
  {
    id: "pages_functions_error_rate_7d",
    label: "Pages Functions 错误率（近 7 日）",
    description:
      "近 7 日滚动错误率（errors / requests × 100），用于抹平单日尖刺",
    unit: "%",
    period: "day",
    defaultQuota: 2,
    category: "workers",
  },
  {
    id: "durable_objects_requests",
    label: "Durable Objects 请求",
    description: "当日 Durable Objects 请求数（免费额度以套餐为准，可自行调整）",
    unit: "次",
    period: "day",
    defaultQuota: 1_000_000,
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
    id: "r2_bandwidth_download",
    label: "R2 下行流量",
    description: "当月 R2 下载流量。R2 出站流量免费，此阈值仅作观测",
    unit: "GB",
    period: "month",
    defaultQuota: 1_000,
    category: "storage",
  },
  {
    id: "r2_bandwidth_upload",
    label: "R2 上行流量",
    description: "当月 R2 上传流量。仅作观测，可按带宽预算调整",
    unit: "GB",
    period: "month",
    defaultQuota: 1_000,
    category: "storage",
  },
  {
    id: "kv_reads",
    label: "KV 读取次数",
    description: "当日 KV 读取次数（免费套餐 10 万次/日）",
    unit: "次",
    period: "day",
    defaultQuota: 100_000,
    category: "storage",
  },
  {
    id: "kv_writes",
    label: "KV 写入次数",
    description: "当日 KV 写入次数（免费套餐 1 千次/日）",
    unit: "次",
    period: "day",
    defaultQuota: 1_000,
    category: "storage",
  },
  {
    id: "kv_deletes",
    label: "KV 删除次数",
    description: "当日 KV 删除次数（免费套餐 1 千次/日）",
    unit: "次",
    period: "day",
    defaultQuota: 1_000,
    category: "storage",
  },
  {
    id: "kv_lists",
    label: "KV 列举次数",
    description: "当日 KV 列举（list）次数（免费套餐 1 千次/日）",
    unit: "次",
    period: "day",
    defaultQuota: 1_000,
    category: "storage",
  },
  {
    id: "kv_storage",
    label: "KV 存储用量",
    description: "所有 KV namespace 的当前存储总量",
    unit: "GB",
    period: "total",
    defaultQuota: 1,
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
  {
    id: "vectorize_storage",
    label: "Vectorize 存储维度",
    description: "当前已存储的向量维度总量（免费额度以套餐为准，可自行调整）",
    unit: "维度",
    period: "total",
    defaultQuota: 10_000_000,
    category: "database",
  },
  {
    id: "vectorize_queries",
    label: "Vectorize 查询维度",
    description: "当月查询的向量维度总量（免费额度以套餐为准，可自行调整）",
    unit: "维度",
    period: "month",
    defaultQuota: 30_000_000,
    category: "database",
  },
  {
    id: "hyperdrive_queries",
    label: "Hyperdrive 查询数",
    description: "当日通过 Hyperdrive 的查询次数（仅作观测）",
    unit: "次",
    period: "day",
    defaultQuota: 1_000_000,
    category: "database",
  },
  {
    id: "ai_neurons",
    label: "Workers AI Neurons",
    description: "当日 Workers AI 消耗的 Neurons（免费套餐 1 万/日）",
    unit: "Neurons",
    period: "day",
    defaultQuota: 10_000,
    category: "ai",
  },
  {
    id: "images_transformations",
    label: "Images 转换次数",
    description: "当月 Cloudflare Images 计费转换次数（免费额度以套餐为准，可自行调整）",
    unit: "次",
    period: "month",
    defaultQuota: 5_000,
    category: "platform",
  },
  {
    id: "logpush_bytes",
    label: "Logpush 流量",
    description: "当月推送的日志数据量。仅作观测，可按预算调整",
    unit: "GB",
    period: "month",
    defaultQuota: 1_000,
    category: "platform",
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

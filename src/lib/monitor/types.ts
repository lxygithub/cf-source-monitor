// 监控指标类型定义（前后端共享）

export type MetricPeriod = "day" | "month" | "total";

export type MetricCategory = "workers" | "storage" | "database" | "custom";

/** 指标使用状态等级 */
export type UsageLevel = "ok" | "warning" | "danger" | "over" | "nodata";

/** 内置（可自动采集）指标 ID */
export type BuiltinMetricId =
  | "workers_requests"
  | "r2_storage"
  | "r2_class_a"
  | "r2_class_b"
  | "d1_rows_read"
  | "d1_rows_written"
  | "d1_storage";

/** 指标注册表条目（服务端定义） */
export interface MetricDef {
  id: BuiltinMetricId;
  label: string;
  description: string;
  unit: string;
  period: MetricPeriod;
  defaultQuota: number;
  category: MetricCategory;
}

/** 单个指标的当前用量状态（返回给前端） */
export interface MetricStatus {
  metric: string;
  label: string;
  description: string;
  unit: string;
  period: MetricPeriod;
  category: MetricCategory;
  used: number | null;
  quota: number;
  percent: number | null;
  remaining: number | null;
  level: UsageLevel;
  custom: boolean;
  customId?: string;
  /** 近 7 日趋势（按天去重，每天取最后一次快照） */
  history: { date: string; used: number }[];
}

/** 账号配置（脱敏后返回前端） */
export interface ConfigInfo {
  configured: boolean;
  demo: boolean;
  name?: string;
  accountId?: string;
  hasToken?: boolean;
}

/** 页面总状态 */
export interface MonitorStatus {
  config: ConfigInfo;
  lastRefreshAt: string | null;
  metrics: MetricStatus[];
  summary: {
    total: number;
    ok: number;
    warning: number;
    danger: number;
    over: number;
    nodata: number;
  };
  errors: string[];
}

/** 用量接口返回 */
export interface RefreshResult {
  ok: boolean;
  errors: string[];
  status?: MonitorStatus;
}

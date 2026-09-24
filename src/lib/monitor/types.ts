// 监控指标类型定义（前后端共享）

export type MetricPeriod = "day" | "month" | "total";

export type MetricCategory =
  | "workers"
  | "storage"
  | "database"
  | "ai"
  | "platform"
  | "custom";

/** 指标使用状态等级 */
export type UsageLevel = "ok" | "warning" | "danger" | "over" | "nodata";

/** 内置（可自动采集）指标 ID */
export type BuiltinMetricId =
  | "workers_requests"
  | "workers_subrequests"
  | "workers_cache_requests"
  | "workers_builds_minutes"
  | "pages_functions_requests"
  | "pages_functions_error_rate"
  | "pages_functions_error_rate_7d"
  | "durable_objects_requests"
  | "r2_storage"
  | "r2_class_a"
  | "r2_class_b"
  | "r2_bandwidth_download"
  | "r2_bandwidth_upload"
  | "kv_reads"
  | "kv_writes"
  | "kv_deletes"
  | "kv_lists"
  | "kv_storage"
  | "d1_rows_read"
  | "d1_rows_written"
  | "d1_storage"
  | "vectorize_storage"
  | "vectorize_queries"
  | "hyperdrive_queries"
  | "ai_neurons"
  | "images_transformations"
  | "logpush_bytes";

/** 指标注册表条目（服务端定义） */
export interface MetricDef {
  /** 内置指标 ID，或拆分视图 ID（如 `kv_reads|ns|<namespaceId>`） */
  id: string;
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
  /** 拆分视图资源信息（KV namespace / D1 库 / Pages 项目） */
  resource?: {
    /** 资源原始 ID（namespace id / 数据库 uuid / 项目数字 ID） */
    id: string;
    /** 展示用 ID（过长时缩略，完整值见 id） */
    idDisplay: string;
    /** 资源显示名（取不到名称时为短 ID） */
    name: string;
    /** 指标短名，如 "Pages 错误率" */
    metricLabel: string;
  };
  /** 所属账号（本系统数据库记录 ID） */
  accountDbId: string;
  /** Cloudflare Account ID */
  accountId: string;
  /** 账号备注名（多账号分组展示 / 告警前缀） */
  accountName: string;
}

/** 单个账号的监控分组 */
export interface AccountGroup {
  /** 本系统数据库记录 ID */
  id: string;
  name: string;
  /** Cloudflare Account ID */
  accountId: string;
  demo: boolean;
  lastRefreshAt: string | null;
  metrics: MetricStatus[];
  builtin: MetricStatus[];
  custom: MetricStatus[];
}

/** 账号摘要信息（账号列表 / 下拉选择） */
export interface AccountInfo {
  id: string;
  name: string;
  accountId: string;
  demo: boolean;
}

/** 页面总状态 */
export interface MonitorStatus {
  /** 当前视图："all" 或账号数据库 ID */
  view: string;
  /** 当前视图下的账号分组 */
  accounts: AccountGroup[];
  /** 全部账号列表（用于切换器 / 账号管理） */
  accountList: AccountInfo[];
  accountCount: number;
  lastRefreshAt: string | null;
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

/** 用量刷新接口返回 */
export interface RefreshResult {
  ok: boolean;
  errors: string[];
}

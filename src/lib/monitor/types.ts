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

// 指标分类元数据：卡片图标与分组标题共用，保证颜色一致

import {
  Bot,
  Database,
  Gauge,
  HardDrive,
  Layers,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface CategoryMeta {
  label: string;
  hint: string;
  icon: LucideIcon;
  /** 图标底色（卡片左上角） */
  chip: string;
  /** 分组标题小圆点 */
  dot: string;
  /** 分组标题左侧竖条 */
  bar: string;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  workers: {
    label: "Workers 与计算",
    hint: "请求、子请求、构建、Pages Functions、Durable Objects",
    icon: Zap,
    chip: "text-orange-500 bg-orange-100 dark:bg-orange-950/60",
    dot: "bg-orange-500",
    bar: "bg-orange-500/70",
  },
  storage: {
    label: "存储",
    hint: "R2、KV",
    icon: HardDrive,
    chip: "text-amber-600 bg-amber-100 dark:bg-amber-950/60",
    dot: "bg-amber-500",
    bar: "bg-amber-500/70",
  },
  database: {
    label: "数据库",
    hint: "D1、Vectorize、Hyperdrive",
    icon: Database,
    chip: "text-emerald-600 bg-emerald-100 dark:bg-emerald-950/60",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500/70",
  },
  ai: {
    label: "Workers AI",
    hint: "Neurons 消耗",
    icon: Bot,
    chip: "text-sky-600 bg-sky-100 dark:bg-sky-950/60",
    dot: "bg-sky-500",
    bar: "bg-sky-500/70",
  },
  platform: {
    label: "平台与其他",
    hint: "Images、Logpush",
    icon: Layers,
    chip: "text-indigo-600 bg-indigo-100 dark:bg-indigo-950/60",
    dot: "bg-indigo-500",
    bar: "bg-indigo-500/70",
  },
  custom: {
    label: "自定义指标",
    hint: "手动记录",
    icon: Gauge,
    chip: "text-violet-600 bg-violet-100 dark:bg-violet-950/60",
    dot: "bg-violet-500",
    bar: "bg-violet-500/70",
  },
};

/** 分组展示顺序 */
export const CATEGORY_ORDER = [
  "workers",
  "storage",
  "database",
  "ai",
  "platform",
] as const;

export const FALLBACK_CATEGORY = CATEGORY_META.custom;

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category] ?? FALLBACK_CATEGORY;
}

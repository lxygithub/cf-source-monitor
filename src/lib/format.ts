// 数字格式化工具（中文习惯：万 / 亿）

function trimNum(x: number): string {
  const abs = Math.abs(x);
  if (Number.isInteger(x)) return x.toLocaleString("en-US");
  if (abs >= 100) return x.toFixed(0);
  if (abs >= 10) return x.toFixed(1);
  return x.toFixed(2);
}

export function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${trimNum(Number((n / 1e8).toFixed(2)))} 亿`;
  if (abs >= 1e4) return `${trimNum(Number((n / 1e4).toFixed(2)))} 万`;
  return trimNum(n);
}

export function formatPercent(p: number): string {
  if (p >= 100) return "100%+";
  return `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%`;
}

export const PERIOD_LABEL: Record<string, string> = {
  day: "每日",
  month: "每月",
  total: "总量",
};

export function formatTime(iso: string | null): string {
  if (!iso) return "从未刷新";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "从未刷新";
  }
}

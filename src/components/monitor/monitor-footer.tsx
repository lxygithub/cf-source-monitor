"use client";

import { Github } from "lucide-react";

export function MonitorFooter() {
  return (
    <footer className="mt-auto border-t bg-muted/30 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1.5 px-4 py-4 text-center text-xs text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
        <p>
          数据来源：Cloudflare Open API（GraphQL Analytics / REST）· 每日额度按 UTC 时间重置
        </p>
        <p className="flex items-center gap-1.5">
          <Github className="size-3.5" />
          cf-source-monitor · 告警阈值 ≥60% 提醒 · ≥85% 告警 · 100% 超限
        </p>
      </div>
    </footer>
  );
}

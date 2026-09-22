"use client";

import { Cloud, RefreshCw, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatTime } from "@/lib/format";
import type { ConfigInfo } from "@/lib/monitor/types";

interface MonitorHeaderProps {
  config: ConfigInfo | null;
  lastRefreshAt: string | null;
  refreshing: boolean;
  autoRefresh: boolean;
  onAutoRefreshChange: (v: boolean) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export function MonitorHeader({
  config,
  lastRefreshAt,
  refreshing,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  onOpenSettings,
}: MonitorHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-500 text-white">
            <Cloud className="size-4.5" />
          </span>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-sm font-semibold sm:text-base">
              CF 资源余量监控
            </h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              最近刷新：{formatTime(lastRefreshAt)}
            </p>
          </div>
          {config?.demo && (
            <Badge className="hidden border-transparent bg-amber-100 text-amber-700 sm:inline-flex dark:bg-amber-950/60 dark:text-amber-400">
              演示数据
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 md:flex">
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={onAutoRefreshChange}
              aria-label="自动刷新开关"
            />
            <Label
              htmlFor="auto-refresh"
              className="cursor-pointer text-xs text-muted-foreground"
            >
              自动刷新（60s）
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="手动刷新用量"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{refreshing ? "刷新中" : "刷新"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenSettings}
            aria-label="打开账号设置"
          >
            <Settings2 className="size-4" />
            <span className="hidden sm:inline">设置</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

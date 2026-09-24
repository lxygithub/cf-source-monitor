"use client";

import { Cloud, RefreshCw, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTime } from "@/lib/format";
import type { AccountInfo } from "@/lib/monitor/types";

interface MonitorHeaderProps {
  accounts: AccountInfo[];
  accountCount: number;
  view: string;
  defaultView: string;
  lastRefreshAt: string | null;
  refreshing: boolean;
  autoRefresh: boolean;
  onAutoRefreshChange: (v: boolean) => void;
  onViewChange: (v: string) => void;
  onSetDefaultView: (v: string) => void;
  onRefresh: () => void;
  onOpenAccounts: () => void;
}

export function MonitorHeader({
  accounts,
  accountCount,
  view,
  defaultView,
  lastRefreshAt,
  refreshing,
  autoRefresh,
  onAutoRefreshChange,
  onViewChange,
  onSetDefaultView,
  onRefresh,
  onOpenAccounts,
}: MonitorHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-3 sm:px-6">
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
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {accountCount >= 2 && (
            <div className="flex items-center gap-1">
              <Select value={view} onValueChange={onViewChange}>
                <SelectTrigger
                  className="h-9 w-[118px] text-xs sm:w-[150px] sm:text-sm"
                  aria-label="切换账号视图"
                >
                  <SelectValue placeholder="账号" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    全部账号（{accountCount}）
                    {defaultView === "all" ? "（默认）" : ""}
                  </SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {defaultView === a.id ? "（默认）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className={`size-8 ${
                  defaultView === view ? "text-amber-500" : "text-muted-foreground"
                }`}
                onClick={() => onSetDefaultView(view)}
                aria-label={
                  defaultView === view ? "取消默认视图" : "设为默认视图"
                }
                title={
                  defaultView === view
                    ? "当前已是默认视图，点击取消"
                    : "把当前视图设为默认（跨设备生效）"
                }
              >
                <Star
                  className={`size-4 ${
                    defaultView === view ? "fill-amber-400" : ""
                  }`}
                />
              </Button>
            </div>
          )}
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
            onClick={onOpenAccounts}
            aria-label="管理账号"
          >
            <Users className="size-4" />
            <span className="hidden sm:inline">账号</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

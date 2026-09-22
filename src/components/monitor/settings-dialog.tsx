"use client";

import { useEffect, useState } from "react";
import { Loader2, PlugZap, Trash2, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { ConfigInfo } from "@/lib/monitor/types";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ConfigInfo | null;
  onSaved: () => Promise<void> | void;
  onCleared: () => Promise<void> | void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  config,
  onSaved,
  onCleared,
}: SettingsDialogProps) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (open) {
      setName(config?.demo ? "" : (config?.name ?? ""));
      setAccountId(config?.demo ? "" : (config?.accountId ?? ""));
      setApiToken("");
      setTestResult(null);
      setConfirmClear(false);
    }
  }, [open, config]);

  const handleTest = async () => {
    if (!apiToken) {
      setTestResult({ ok: false, msg: "请先填写 API Token" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: accountId.trim() || undefined,
          apiToken: apiToken.trim(),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string };
      setTestResult({
        ok: data.ok,
        msg: data.ok ? (data.message ?? "连接成功") : (data.error ?? "连接失败"),
      });
    } catch {
      setTestResult({ ok: false, msg: "网络错误，请稍后重试" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!accountId.trim() || !apiToken.trim()) {
      toast.error("请填写 Account ID 与 API Token");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          accountId: accountId.trim(),
          apiToken: apiToken.trim(),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "保存失败");
        return;
      }
      toast.success("配置已保存，正在刷新用量…");
      onOpenChange(false);
      await onSaved();
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const handleExitDemo = async () => {
    try {
      await fetch("/api/demo", { method: "DELETE" });
      toast.success("已退出演示模式");
      onOpenChange(false);
      await onCleared();
    } catch {
      toast.error("操作失败，请重试");
    }
  };

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    try {
      await fetch("/api/config", { method: "DELETE" });
      toast.success("已清除配置");
      onOpenChange(false);
      await onCleared();
    } catch {
      toast.error("操作失败，请重试");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>账号设置</DialogTitle>
          <DialogDescription>
            配置 Cloudflare Account ID 与 API Token，用于自动采集资源用量
          </DialogDescription>
        </DialogHeader>

        {config?.demo && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTitle>当前为演示模式</AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-400">
              展示的是模拟数据。填写真实账号配置即可切换为实际监控，或直接退出演示模式。
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cfg-name">账号备注名（可选）</Label>
            <Input
              id="cfg-name"
              placeholder="例如：我的主账号"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cfg-account">Account ID</Label>
            <Input
              id="cfg-account"
              placeholder="32 位十六进制，Dashboard 首页右侧可见"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cfg-token">API Token</Label>
            <Input
              id="cfg-token"
              type="password"
              placeholder="粘贴 API Token（仅保存在本地数据库）"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              创建 Token 时建议仅授予：<b>Account → Account Analytics → Read</b> 与{" "}
              <b>Account → D1 → Read</b> 两项只读权限。
            </p>
          </div>

          {testResult && (
            <p
              className={`text-sm font-medium ${
                testResult.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
              role="status"
            >
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.msg}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {config?.demo ? (
            <Button variant="outline" onClick={handleExitDemo} className="w-full sm:w-auto">
              <LogOut className="size-4" />
              退出演示模式
            </Button>
          ) : config?.configured ? (
            <Button
              variant="ghost"
              onClick={handleClear}
              className={`w-full text-red-600 hover:text-red-600 sm:w-auto dark:text-red-400 ${
                confirmClear ? "bg-red-100 dark:bg-red-950/60" : ""
              }`}
            >
              <Trash2 className="size-4" />
              {confirmClear ? "再次点击确认清除" : "清除配置"}
            </Button>
          ) : null}
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing}
              className="flex-1 sm:flex-none"
            >
              {testing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlugZap className="size-4" />
              )}
              测试连接
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-orange-500 hover:bg-orange-600 sm:flex-none"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>

        <Separator className="mt-1" />
        <p className="text-center text-xs text-muted-foreground">
          Token 仅存储在本地 SQLite 数据库中，不会上传到任何第三方服务
        </p>
      </DialogContent>
    </Dialog>
  );
}

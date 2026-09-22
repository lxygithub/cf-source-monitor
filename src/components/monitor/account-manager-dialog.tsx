"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Cloud,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  Trash2,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AccountInfo } from "@/lib/monitor/types";

interface AccountManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 任何账号变动后回调（刷新主页面数据） */
  onChanged: () => Promise<void> | void;
}

type Mode = "list" | "add" | "edit";

/** 多账号管理：列表 / 添加 / 编辑 / 删除 / 移除演示账号 */
export function AccountManagerDialog({
  open,
  onOpenChange,
  onChanged,
}: AccountManagerDialogProps) {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [mode, setMode] = useState<Mode>("list");
  const [editing, setEditing] = useState<AccountInfo | null>(null);

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const data = (await res.json()) as { accounts: AccountInfo[] };
      setAccounts(data.accounts ?? []);
    } catch {
      toast.error("读取账号列表失败");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setMode("list");
      setEditing(null);
      setConfirmDeleteId(null);
      void fetchAccounts();
    }
  }, [open, fetchAccounts]);

  const resetForm = () => {
    setName("");
    setAccountId("");
    setApiToken("");
    setTestResult(null);
  };

  const startAdd = () => {
    resetForm();
    setEditing(null);
    setMode("add");
  };

  const startEdit = (a: AccountInfo) => {
    setName(a.name);
    setAccountId(a.accountId);
    setApiToken("");
    setTestResult(null);
    setEditing(a);
    setMode("edit");
  };

  const handleTest = async () => {
    if (!apiToken.trim()) {
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
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
      };
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
    if (!accountId.trim()) {
      toast.error("请填写 Account ID");
      return;
    }
    if (mode === "add" && !apiToken.trim()) {
      toast.error("请填写 API Token");
      return;
    }
    setSaving(true);
    try {
      const isAdd = mode === "add";
      const res = await fetch(
        isAdd ? "/api/config" : `/api/config/${editing?.id}`,
        {
          method: isAdd ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            accountId: accountId.trim(),
            apiToken: apiToken.trim() || undefined,
          }),
        }
      );
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "保存失败");
        return;
      }
      toast.success(isAdd ? "账号已添加" : "账号已更新");
      resetForm();
      setMode("list");
      setEditing(null);
      await fetchAccounts();
      await onChanged();
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (a: AccountInfo) => {
    if (confirmDeleteId !== a.id) {
      setConfirmDeleteId(a.id);
      return;
    }
    try {
      const res = await fetch(`/api/config/${a.id}`, { method: "DELETE" });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "删除失败");
        return;
      }
      toast.success(`已删除「${a.name}」`);
      setConfirmDeleteId(null);
      await fetchAccounts();
      await onChanged();
    } catch {
      toast.error("网络错误，请稍后重试");
    }
  };

  const handleExitDemo = async () => {
    try {
      await fetch("/api/demo", { method: "DELETE" });
      toast.success("已移除演示账号");
      await fetchAccounts();
      await onChanged();
    } catch {
      toast.error("操作失败，请重试");
    }
  };

  const hasDemo = accounts.some((a) => a.demo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>账号管理</DialogTitle>
          <DialogDescription>
            支持添加多个 Cloudflare 账号，分别监控各自的资源余量
          </DialogDescription>
        </DialogHeader>

        {mode === "list" ? (
          <div className="space-y-3">
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {loadingList ? (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  加载中…
                </div>
              ) : accounts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  暂无账号，点击下方按钮添加
                </p>
              ) : (
                accounts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
                      <Cloud className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {a.name}
                        {a.demo && (
                          <Badge className="border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                            演示
                          </Badge>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {a.accountId}
                      </p>
                    </div>
                    {!a.demo && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        onClick={() => startEdit(a)}
                        aria-label={`编辑账号 ${a.name}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`size-8 shrink-0 ${
                        confirmDeleteId === a.id
                          ? "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400"
                          : "text-muted-foreground hover:text-red-600"
                      }`}
                      onClick={() => void handleDelete(a)}
                      aria-label={`删除账号 ${a.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {confirmDeleteId && (
              <p className="text-xs text-red-600 dark:text-red-400">
                再点一次「删除」图标确认；删除后该账号的配额、快照与自定义指标都会一并清除。
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={startAdd}
                className="flex-1 bg-orange-500 hover:bg-orange-600"
              >
                <Plus className="size-4" />
                添加账号
              </Button>
              {hasDemo && (
                <Button variant="outline" onClick={handleExitDemo}>
                  <LogOut className="size-4" />
                  移除演示账号
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="acc-name">账号备注名（可选）</Label>
              <Input
                id="acc-name"
                placeholder="例如：我的主账号"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-id">Account ID</Label>
              <Input
                id="acc-id"
                placeholder="32 位十六进制，Dashboard 首页右侧可见"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                autoComplete="off"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-token">
                API Token{mode === "edit" && "（留空表示保持不变）"}
              </Label>
              <Input
                id="acc-token"
                type="password"
                placeholder="粘贴 API Token（仅保存在本地数据库）"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                autoComplete="off"
                className="font-mono text-sm"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                创建 Token 时建议仅授予：
                <b>Account → Account Analytics → Read</b> 与{" "}
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

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setMode("list");
                  setEditing(null);
                }}
                className="flex-1"
              >
                返回列表
              </Button>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing}
                className="flex-1"
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
                className="flex-1 bg-orange-500 hover:bg-orange-600"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                保存
              </Button>
            </div>
          </div>
        )}

        <Separator className="mt-1" />
        <p className="text-center text-xs text-muted-foreground">
          Token 仅存储在本地数据库中，不会上传到任何第三方服务
        </p>
      </DialogContent>
    </Dialog>
  );
}

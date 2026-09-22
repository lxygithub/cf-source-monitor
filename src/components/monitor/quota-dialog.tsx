"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { PERIOD_LABEL, formatNumber } from "@/lib/format";
import type { MetricStatus } from "@/lib/monitor/types";

interface QuotaDialogProps {
  metric: MetricStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}

/** 调整内置指标配额（如升级为付费套餐后修改上限） */
export function QuotaDialog({ metric, open, onOpenChange, onSaved }: QuotaDialogProps) {
  const [quota, setQuota] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && metric) setQuota(String(metric.quota));
  }, [open, metric]);

  if (!metric) return null;

  const handleSubmit = async () => {
    const quotaNum = Number(quota);
    if (!quotaNum || quotaNum <= 0) {
      toast.error("配额必须大于 0");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/quotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: metric.accountId,
          metric: metric.metric,
          quota: quotaNum,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "保存失败");
        return;
      }
      toast.success("配额已更新");
      onOpenChange(false);
      await onSaved();
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>调整配额 · {metric.label}</DialogTitle>
          <DialogDescription>
            当前用量 {metric.used === null ? "--" : formatNumber(metric.used)} {metric.unit}
            ，{PERIOD_LABEL[metric.period]}额度默认为 Free 套餐标准，升级付费套餐后可在此修改
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="quota-input">配额上限（{metric.unit}）</Label>
          <Input
            id="quota-input"
            type="number"
            min="1"
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full bg-orange-500 hover:bg-orange-600"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

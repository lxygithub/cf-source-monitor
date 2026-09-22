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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MetricStatus } from "@/lib/monitor/types";

interface CustomMetricDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑时传入已有指标 */
  editing: MetricStatus | null;
  onSaved: () => Promise<void> | void;
}

/** 新建 / 编辑自定义监控指标 */
export function CustomMetricDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: CustomMetricDialogProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("次");
  const [period, setPeriod] = useState("day");
  const [quota, setQuota] = useState("");
  const [used, setUsed] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setName(editing.label);
        setUnit(editing.unit);
        setPeriod(editing.period);
        setQuota(String(editing.quota));
        setUsed(String(editing.used ?? 0));
      } else {
        setName("");
        setUnit("次");
        setPeriod("day");
        setQuota("");
        setUsed("0");
      }
    }
  }, [open, editing]);

  const handleSubmit = async () => {
    const quotaNum = Number(quota);
    const usedNum = Number(used);
    if (!name.trim()) {
      toast.error("请填写指标名称");
      return;
    }
    if (!quotaNum || quotaNum <= 0) {
      toast.error("配额必须大于 0");
      return;
    }
    setSaving(true);
    try {
      const url = editing?.customId
        ? `/api/custom-metrics/${editing.customId}`
        : "/api/custom-metrics";
      const res = await fetch(url, {
        method: editing?.customId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          unit: unit.trim() || "次",
          period,
          quota: quotaNum,
          used: usedNum >= 0 ? usedNum : 0,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? "保存失败");
        return;
      }
      toast.success(editing ? "指标已更新" : "指标已添加");
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
          <DialogTitle>{editing ? "编辑自定义指标" : "添加自定义指标"}</DialogTitle>
          <DialogDescription>
            适用于 API 无法自动采集的资源（如 KV 读写、Pages 构建次数等），手动记录用量
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cm-name">指标名称</Label>
            <Input
              id="cm-name"
              placeholder="例如：KV 读取次数"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cm-unit">单位</Label>
              <Input
                id="cm-unit"
                placeholder="次"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>统计周期</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-full" aria-label="统计周期">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">每日</SelectItem>
                  <SelectItem value="month">每月</SelectItem>
                  <SelectItem value="total">总量</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cm-quota">配额上限</Label>
              <Input
                id="cm-quota"
                type="number"
                min="1"
                placeholder="100000"
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cm-used">当前用量</Label>
              <Input
                id="cm-used"
                type="number"
                min="0"
                value={used}
                onChange={(e) => setUsed(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full bg-orange-500 hover:bg-orange-600"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {editing ? "保存修改" : "添加指标"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

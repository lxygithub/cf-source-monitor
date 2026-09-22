"use client";

import { Cloud, KeyRound, MousePointerClick, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STEPS = [
  {
    icon: Cloud,
    title: "获取 Account ID",
    desc: "登录 Cloudflare Dashboard，首页右侧即可复制 32 位 Account ID",
  },
  {
    icon: KeyRound,
    title: "创建 API Token",
    desc: "My Profile → API Tokens → 创建令牌，授予 Account Analytics:Read 与 D1:Read 只读权限",
  },
  {
    icon: MousePointerClick,
    title: "填入并保存",
    desc: "点击右上角「设置」填入信息，保存后即可自动采集用量并生成趋势快照",
  },
];

const FEATURES = [
  "Workers 请求量",
  "R2 存储与操作数",
  "D1 读写行数",
  "自定义指标",
  "阈值告警提醒",
  "近 7 日趋势",
];

interface OnboardingProps {
  onOpenSettings: () => void;
  onSeedDemo: () => Promise<void>;
  seeding: boolean;
}

/** 未配置账号时的引导页 */
export function Onboarding({ onOpenSettings, onSeedDemo, seeding }: OnboardingProps) {
  return (
    <Card className="border-2 border-dashed border-orange-200 bg-gradient-to-b from-orange-50/60 to-transparent dark:border-orange-900/60 dark:from-orange-950/20">
      <CardContent className="flex flex-col items-center gap-8 px-6 py-12 text-center sm:py-16">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/25">
          <Cloud className="size-8" />
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight">
            开始监控 Cloudflare 资源余量
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            自动采集 Workers、R2、D1 等资源的配额使用情况，接近限额时分级告警，
            避免免费额度意外超限导致服务中断
          </p>
        </div>

        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="flex flex-col items-center gap-2 rounded-xl border bg-card/60 p-4 text-center"
            >
              <span className="relative">
                <span className="flex size-10 items-center justify-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
                  <step.icon className="size-5" />
                </span>
                <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
              </span>
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            onClick={onOpenSettings}
            size="lg"
            className="bg-orange-500 text-white hover:bg-orange-600"
          >
            立即配置账号
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => void onSeedDemo()}
            disabled={seeding}
          >
            {seeding ? "生成中…" : "先看看演示数据"}
          </Button>
        </div>

        <div className="flex max-w-xl flex-wrap justify-center gap-2">
          {FEATURES.map((f) => (
            <span
              key={f}
              className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground"
            >
              {f}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export { RefreshCw };

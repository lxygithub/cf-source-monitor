import { NextRequest, NextResponse } from "next/server";
import { setQuota } from "@/lib/monitor/service";

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      accountId?: string;
      metric?: string;
      quota?: number;
    };
    if (!body.accountId) {
      return NextResponse.json(
        { ok: false, error: "缺少账号标识" },
        { status: 400 }
      );
    }
    if (!body.metric || typeof body.quota !== "number" || !isFinite(body.quota) || body.quota <= 0) {
      return NextResponse.json(
        { ok: false, error: "参数不合法" },
        { status: 400 }
      );
    }
    await setQuota(body.accountId, body.metric, body.quota);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 }
    );
  }
}

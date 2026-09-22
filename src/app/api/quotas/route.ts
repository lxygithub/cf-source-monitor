import { NextRequest, NextResponse } from "next/server";
import { getAccount, setQuota } from "@/lib/monitor/service";

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { metric?: string; quota?: number };
    const account = await getAccount();
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "尚未配置账号" },
        { status: 400 }
      );
    }
    if (!body.metric || typeof body.quota !== "number" || !isFinite(body.quota) || body.quota <= 0) {
      return NextResponse.json(
        { ok: false, error: "参数不合法" },
        { status: 400 }
      );
    }
    await setQuota(account.accountId, body.metric, body.quota);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 }
    );
  }
}

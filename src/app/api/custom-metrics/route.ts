import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/monitor/service";

const VALID_PERIODS = ["day", "month", "total"];

export async function POST(req: NextRequest) {
  try {
    const account = await getAccount();
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "尚未配置账号" },
        { status: 400 }
      );
    }
    const body = (await req.json()) as {
      name?: string;
      unit?: string;
      period?: string;
      quota?: number;
      used?: number;
    };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { ok: false, error: "请填写指标名称" },
        { status: 400 }
      );
    }
    if (typeof body.quota !== "number" || body.quota <= 0) {
      return NextResponse.json(
        { ok: false, error: "配额必须大于 0" },
        { status: 400 }
      );
    }
    const period = body.period && VALID_PERIODS.includes(body.period) ? body.period : "day";
    const exists = await db.customMetric.findFirst({
      where: { accountId: account.accountId, name },
    });
    if (exists) {
      return NextResponse.json(
        { ok: false, error: "同名指标已存在" },
        { status: 400 }
      );
    }
    const created = await db.customMetric.create({
      data: {
        accountId: account.accountId,
        name,
        unit: body.unit?.trim() || "次",
        period,
        quota: body.quota,
        used: typeof body.used === "number" && body.used >= 0 ? body.used : 0,
      },
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "创建失败" },
      { status: 500 }
    );
  }
}

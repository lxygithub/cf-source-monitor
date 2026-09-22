import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/monitor/service";

const VALID_PERIODS = ["day", "month", "total"];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const account = await getAccount();
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "尚未配置账号" },
        { status: 400 }
      );
    }
    const existing = await db.customMetric.findFirst({
      where: { id, accountId: account.accountId },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "指标不存在" },
        { status: 404 }
      );
    }
    const body = (await req.json()) as {
      name?: string;
      unit?: string;
      period?: string;
      quota?: number;
      used?: number;
    };
    const data: Record<string, unknown> = {};
    if (body.name?.trim()) data.name = body.name.trim();
    if (body.unit?.trim()) data.unit = body.unit.trim();
    if (body.period && VALID_PERIODS.includes(body.period)) data.period = body.period;
    if (typeof body.quota === "number" && body.quota > 0) data.quota = body.quota;
    if (typeof body.used === "number" && body.used >= 0) data.used = body.used;
    await db.customMetric.update({ where: { id: existing.id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "更新失败" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const account = await getAccount();
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "尚未配置账号" },
        { status: 400 }
      );
    }
    await db.customMetric.deleteMany({
      where: { id, accountId: account.accountId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "删除失败" },
      { status: 500 }
    );
  }
}

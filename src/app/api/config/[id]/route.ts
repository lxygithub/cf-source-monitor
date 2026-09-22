import { NextRequest, NextResponse } from "next/server";
import { deleteAccount, updateAccount } from "@/lib/monitor/service";

/** 更新账号（Token 留空表示保持不变） */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      name?: string;
      accountId?: string;
      apiToken?: string;
    };
    if (body.accountId && !/^[a-f0-9]{32}$/i.test(body.accountId.trim())) {
      return NextResponse.json(
        { ok: false, error: "Account ID 格式不正确" },
        { status: 400 }
      );
    }
    const result = await updateAccount(id, body);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "更新失败" },
      { status: 500 }
    );
  }
}

/** 删除账号及其全部监控数据 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteAccount(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "删除失败" },
      { status: 500 }
    );
  }
}

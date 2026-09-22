import { NextRequest, NextResponse } from "next/server";
import { refreshAccounts } from "@/lib/monitor/service";

/** 刷新用量：body.accountId 指定单个账号，缺省刷新全部 */
export async function POST(req: NextRequest) {
  try {
    let accountId: string | undefined;
    try {
      const body = (await req.json()) as { accountId?: string };
      accountId = body?.accountId;
    } catch {
      // 无 body 时视为全部刷新
    }

    const { errors, refreshed } = await refreshAccounts(
      accountId ? [accountId] : undefined
    );
    if (refreshed === 0) {
      return NextResponse.json(
        {
          ok: false,
          errors: ["未找到要刷新的账号，请先在「账号」中添加"],
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, errors, refreshed });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        errors: [err instanceof Error ? err.message : "刷新失败"],
      },
      { status: 500 }
    );
  }
}

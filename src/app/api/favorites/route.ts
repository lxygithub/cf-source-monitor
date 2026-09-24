import { NextRequest, NextResponse } from "next/server";
import { getAccounts, setFavorite } from "@/lib/monitor/service";

/** 收藏 / 取消收藏某个指标卡片 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      accountDbId?: string;
      metric?: string;
      favorite?: boolean;
    };
    const metric = body.metric?.trim();
    if (!body.accountDbId || !metric) {
      return NextResponse.json(
        { ok: false, error: "缺少 accountDbId 或 metric" },
        { status: 400 }
      );
    }

    const accounts = await getAccounts();
    const account = accounts.find((a) => a.id === body.accountDbId);
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "账号不存在" },
        { status: 404 }
      );
    }

    await setFavorite(account.accountId, metric, body.favorite !== false);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "操作失败" },
      { status: 500 }
    );
  }
}

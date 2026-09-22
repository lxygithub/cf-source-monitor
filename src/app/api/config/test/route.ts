import { NextRequest, NextResponse } from "next/server";
import {
  CloudflareApiError,
  verifyAccountAccess,
  verifyToken,
} from "@/lib/monitor/cloudflare";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      accountId?: string;
      apiToken?: string;
    };
    const accountId = body.accountId?.trim();
    const apiToken = body.apiToken?.trim();
    if (!apiToken) {
      return NextResponse.json(
        { ok: false, error: "请填写 API Token" },
        { status: 400 }
      );
    }

    try {
      await verifyToken(apiToken, accountId);
    } catch (err) {
      const msg =
        err instanceof CloudflareApiError
          ? err.message
          : "Token 校验请求失败，请检查网络";
      return NextResponse.json({ ok: false, error: `Token 无效：${msg}` });
    }

    if (accountId) {
      const accountCheck = await verifyAccountAccess(apiToken, accountId);
      if (!accountCheck.ok) {
        return NextResponse.json({ ok: false, error: accountCheck.message });
      }
    }

    return NextResponse.json({ ok: true, message: "连接成功，Token 有效" });
  } catch {
    return NextResponse.json(
      { ok: false, error: "连接测试失败，请稍后重试" },
      { status: 500 }
    );
  }
}

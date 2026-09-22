import { NextRequest, NextResponse } from "next/server";
import { addAccount, listAccountInfos } from "@/lib/monitor/service";

/** 账号列表 */
export async function GET() {
  const accounts = await listAccountInfos();
  return NextResponse.json({ accounts });
}

/** 添加账号 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      accountId?: string;
      apiToken?: string;
    };
    const accountId = body.accountId?.trim();
    const apiToken = body.apiToken?.trim();
    if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Account ID 格式不正确（应为 32 位十六进制字符串，演示账号除外）",
        },
        { status: 400 }
      );
    }
    if (!apiToken) {
      return NextResponse.json(
        { ok: false, error: "请填写 API Token" },
        { status: 400 }
      );
    }
    const result = await addAccount({ name: body.name, accountId, apiToken });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 }
    );
  }
}

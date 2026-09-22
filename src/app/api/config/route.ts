import { NextRequest, NextResponse } from "next/server";
import { clearConfig, getConfigInfo, saveConfig } from "@/lib/monitor/service";

export async function GET() {
  const config = await getConfigInfo();
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
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
        { ok: false, error: "Account ID 格式不正确（应为 32 位十六进制字符串）" },
        { status: 400 }
      );
    }
    if (!apiToken) {
      return NextResponse.json(
        { ok: false, error: "请填写 API Token" },
        { status: 400 }
      );
    }
    await saveConfig({ name: body.name, accountId, apiToken });
    return NextResponse.json({ ok: true, config: await getConfigInfo() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  await clearConfig();
  return NextResponse.json({ ok: true });
}

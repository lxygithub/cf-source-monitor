import { NextRequest, NextResponse } from "next/server";
import { getDefaultView, setDefaultView } from "@/lib/monitor/service";

/** 读取默认账号视图 */
export async function GET() {
  return NextResponse.json({ ok: true, defaultView: await getDefaultView() });
}

/** 设置默认账号视图：body.defaultView 为账号数据库 ID，传 "all" 清除 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { defaultView?: string };
    await setDefaultView(body.defaultView ?? "all");
    return NextResponse.json({ ok: true, defaultView: await getDefaultView() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "设置失败" },
      { status: 500 }
    );
  }
}

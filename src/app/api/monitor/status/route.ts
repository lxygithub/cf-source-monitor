import { NextRequest, NextResponse } from "next/server";
import { getStatus } from "@/lib/monitor/service";

/** 获取监控状态：?view=all | <账号数据库 ID> */
export async function GET(req: NextRequest) {
  try {
    const view = req.nextUrl.searchParams.get("view") || "all";
    const status = await getStatus(view);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取状态失败" },
      { status: 500 }
    );
  }
}

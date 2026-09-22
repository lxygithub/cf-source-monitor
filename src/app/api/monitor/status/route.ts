import { NextResponse } from "next/server";
import { getStatus } from "@/lib/monitor/service";

export async function GET() {
  try {
    const status = await getStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取状态失败" },
      { status: 500 }
    );
  }
}

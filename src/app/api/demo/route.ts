import { NextResponse } from "next/server";
import { exitDemo, seedDemo } from "@/lib/monitor/service";

/** 开启演示模式（写入模拟数据） */
export async function POST() {
  try {
    await seedDemo();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "演示数据生成失败" },
      { status: 500 }
    );
  }
}

/** 退出演示模式（清空配置与数据） */
export async function DELETE() {
  try {
    await exitDemo();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "操作失败" },
      { status: 500 }
    );
  }
}

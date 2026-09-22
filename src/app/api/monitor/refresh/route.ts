import { NextResponse } from "next/server";
import {
  DEMO_ACCOUNT_ID,
  getAccount,
  getStatus,
  refreshDemo,
  refreshRealAccount,
} from "@/lib/monitor/service";

export async function POST() {
  try {
    const account = await getAccount();
    if (!account) {
      return NextResponse.json(
        { ok: false, errors: ["尚未配置账号，请先在设置中填写 Account ID 与 API Token"] },
        { status: 400 }
      );
    }

    let errors: string[];
    if (account.accountId === DEMO_ACCOUNT_ID) {
      ({ errors } = await refreshDemo());
    } else {
      ({ errors } = await refreshRealAccount(account.accountId, account.apiToken));
    }

    const status = await getStatus(errors);
    return NextResponse.json({ ok: true, errors, status });
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

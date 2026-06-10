import { NextResponse } from "next/server";
import { igLogin } from "@/lib/ig-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await igLogin();
    return NextResponse.json({
      cst: session.cst,
      securityToken: session.securityToken,
      accountId: session.accountId,
      lightstreamerEndpoint: session.lightstreamerEndpoint,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

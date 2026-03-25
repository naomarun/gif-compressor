// API route removed - compression is handled client-side via WASM
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "このAPIは廃止されました。クライアントサイドで圧縮が行われます。" },
    { status: 410 }
  );
}

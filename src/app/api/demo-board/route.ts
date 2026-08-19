import { NextResponse } from "next/server";
import { isDemoBoardAccount } from "@/lib/demo-board-types";
import { loadDemoBoard } from "@/lib/demo-board-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account") || "";
  if (!isDemoBoardAccount(account)) {
    return NextResponse.json({ error: "Choose a valid Muse sample board." }, { status: 404 });
  }
  try {
    const board = await loadDemoBoard(account);
    if (!board) {
      return NextResponse.json({ error: `${account} is not ready to be shown as a sample board yet.` }, { status: 404 });
    }
    return NextResponse.json({ board }, {
      headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The sample board could not be loaded." }, { status: 500 });
  }
}

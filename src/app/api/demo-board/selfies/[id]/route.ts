import { NextResponse } from "next/server";
import { demoBoardUser } from "@/lib/demo-board-store";
import { readStoredSelfie } from "@/lib/selfie-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = new URL(request.url).searchParams.get("account") || "";
  const demoUser = await demoBoardUser(account);
  if (!demoUser) return NextResponse.json({ error: "Sample photo not found." }, { status: 404 });
  const { id } = await params;
  const stored = await readStoredSelfie(id, demoUser.id);
  if (!stored) return NextResponse.json({ error: "Sample photo not found." }, { status: 404 });
  return new Response(stored.result.stream, {
    headers: {
      "Cache-Control": "public, max-age=300, must-revalidate",
      "Content-Disposition": "inline",
      "Content-Length": String(stored.result.blob.size),
      "Content-Type": stored.result.blob.contentType || stored.row.content_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

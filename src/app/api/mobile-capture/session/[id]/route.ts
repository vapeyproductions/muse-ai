import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { mobileCaptureForUser } from "@/lib/mobile-capture-store";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to receive phone photos." }, { status: 401 });
  const { id } = await params;
  const capture = await mobileCaptureForUser(id, session.user.id);
  if (!capture) return NextResponse.json({ error: "Capture session not found." }, { status: 404 });
  return NextResponse.json({ capture }, { headers: { "Cache-Control": "no-store" } });
}

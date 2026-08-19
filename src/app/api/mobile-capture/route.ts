import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createMobileCaptureSession } from "@/lib/mobile-capture-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to connect your phone." }, { status: 401 });
  try {
    const capture = await createMobileCaptureSession(session.user.id, new URL(request.url).origin);
    return NextResponse.json({ capture }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Phone capture could not be started." }, { status: 400 });
  }
}

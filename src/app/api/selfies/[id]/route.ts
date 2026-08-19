import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteStoredSelfie, readStoredSelfie } from "@/lib/selfie-store";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to view this selfie." }, { status: 401 });
  const { id } = await params;
  const stored = await readStoredSelfie(id, session.user.id);
  if (!stored) return NextResponse.json({ error: "Selfie not found." }, { status: 404 });

  return new Response(stored.result.stream, {
    headers: {
      "Cache-Control": "private, max-age=300, must-revalidate",
      "Content-Disposition": "inline",
      "Content-Length": String(stored.result.blob.size),
      "Content-Type": stored.result.blob.contentType || stored.row.content_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to delete selfies." }, { status: 401 });
  const { id } = await params;
  const result = await deleteStoredSelfie(id, session.user.id);
  if (result === "not-found") return NextResponse.json({ error: "Selfie not found." }, { status: 404 });
  if (result === "protected") {
    return NextResponse.json({ error: "Your current assessment selfie cannot be deleted. Recalibrate to replace it." }, { status: 409 });
  }
  return NextResponse.json({ removed: true });
}

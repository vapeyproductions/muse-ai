import { NextResponse } from "next/server";
import { readGeneratedLookTemplate } from "@/lib/look-template-store";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ lookId: string }> }) {
  const { lookId } = await params;
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token || token.length > 180) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  const stored = await readGeneratedLookTemplate(lookId, token);
  if (!stored) return NextResponse.json({ error: "Template not found." }, { status: 404 });

  return new Response(stored.blob.stream, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
      "Content-Length": String(stored.blob.blob.size),
      "Content-Type": stored.blob.blob.contentType || stored.template.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

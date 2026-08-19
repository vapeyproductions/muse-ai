import { NextResponse } from "next/server";
import sharp from "sharp";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Sign in to prepare an assessment photo." }, {
      status: 401,
      headers: PRIVATE_NO_STORE,
    });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a photo to prepare.");
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Assessment photos must be JPG, PNG, or WebP images.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Assessment photos must be under 10 MB.");

    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { failOn: "none" }).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 320) {
      throw new Error("This photo is too small. Choose an image at least 320 × 320 pixels.");
    }

    // Sharp's attention crop weighs skin tone, luminance, and high-frequency
    // detail. On wide studio photographs this centers the subject's face
    // instead of blindly taking the geometric middle or trimming the hairline.
    const portrait = await image
      .resize({
        width: 900,
        height: 1200,
        fit: "cover",
        position: sharp.strategy.attention,
      })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
      .toBuffer();

    return new Response(new Uint8Array(portrait), {
      headers: {
        ...PRIVATE_NO_STORE,
        "Content-Disposition": "inline; filename=assessment-portrait.jpg",
        "Content-Length": String(portrait.byteLength),
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Muse could not prepare this photo.",
    }, {
      status: 400,
      headers: PRIVATE_NO_STORE,
    });
  }
}

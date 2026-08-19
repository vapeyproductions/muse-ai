import { NextResponse } from "next/server";
import {
  claimMobileCapture,
  completeMobileCapture,
  mobileCaptureForToken,
  releaseMobileCapture,
} from "@/lib/mobile-capture-store";
import { deleteStoredSelfie, storeUploadedSelfie, type StoredSelfie } from "@/lib/selfie-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 1.25 * 1024 * 1024;

function captureToken(request: Request) {
  const token = request.headers.get("x-muse-capture-token")?.trim() || "";
  return token.length >= 32 && token.length <= 128 ? token : "";
}

function requiredImage(form: FormData, name: string) {
  const file = form.get(name);
  if (!(file instanceof File) || !file.size) throw new Error(`Missing ${name} photo.`);
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("The photo must be a JPG, PNG, or WebP image.");
  if (file.size > MAX_FILE_BYTES) throw new Error("The photo is too large. Please capture again.");
  return file;
}

export async function GET(request: Request) {
  const token = captureToken(request);
  if (!token) return NextResponse.json({ error: "This capture link is invalid." }, { status: 401 });
  const capture = await mobileCaptureForToken(token);
  if (!capture) return NextResponse.json({ error: "This capture link was not found." }, { status: 404 });
  return NextResponse.json({ capture: { status: capture.status, expiresAt: capture.expiresAt } }, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function POST(request: Request) {
  const token = captureToken(request);
  if (!token) return NextResponse.json({ error: "This capture link is invalid." }, { status: 401 });
  const claimed = await claimMobileCapture(token);
  if (!claimed) {
    return NextResponse.json({ error: "This capture link has expired or was already used." }, { status: 409 });
  }

  const saved: StoredSelfie[] = [];
  try {
    const form = await request.formData();
    const face = requiredImage(form, "face");
    saved.push(await storeUploadedSelfie(face, claimed.user_id, "Guided front selfie"));
    await completeMobileCapture({
      id: claimed.id,
      userId: claimed.user_id,
      faceSelfieId: saved[0].id,
    });
    return NextResponse.json({ complete: true }, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    await Promise.allSettled(saved.map((selfie) => deleteStoredSelfie(selfie.id, claimed.user_id)));
    await releaseMobileCapture(claimed.id, claimed.user_id);
    return NextResponse.json({ error: error instanceof Error ? error.message : "The photo could not be transferred." }, { status: 400 });
  }
}

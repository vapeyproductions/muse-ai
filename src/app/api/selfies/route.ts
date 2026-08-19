import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  assessmentPhotoSetForUser,
  selfieForUser,
  selfiesForUser,
  storeUploadedSelfie,
} from "@/lib/selfie-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SERVER_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to access saved selfies." }, { status: 401 });
  const [selfies, assessmentPhotos] = await Promise.all([
    selfiesForUser(session.user.id),
    assessmentPhotoSetForUser(session.user.id),
  ]);
  if (!selfies.length) return NextResponse.json({ error: "No saved selfie yet." }, { status: 404 });
  const currentAssessmentId = assessmentPhotos?.face.id;
  const library = selfies.map((selfie) => ({
    ...selfie,
    deletable: selfie.sourceKind === "generated" || selfie.id !== currentAssessmentId,
  }));
  return NextResponse.json({ selfie: library[0], selfies: library, assessmentPhotos });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to save selfies." }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    const requestedLabel = String(form.get("label") || "Selfie").trim();
    const assessmentRole = String(form.get("assessmentRole") || "");
    const parentId = String(form.get("parentId") || "").trim() || null;
    const assessmentLabels: Record<string, string> = {
      face: "Assessment selfie",
      hairLeft: "Assessment left hair angle",
      hairRight: "Assessment right hair angle",
    };
    const label = assessmentLabels[assessmentRole] || requestedLabel;
    if (!(file instanceof File) || !file.size) throw new Error("Choose a selfie to save.");
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Selfies must be JPG, PNG, or WebP images.");
    if (file.size > MAX_SERVER_UPLOAD_BYTES) throw new Error("The storage copy must be under 4 MB.");
    if ((assessmentRole === "hairLeft" || assessmentRole === "hairRight") && !parentId) {
      throw new Error("Save the front assessment photo before its side views.");
    }
    if (parentId && !await selfieForUser(parentId, session.user.id)) {
      throw new Error("The front assessment photo is unavailable.");
    }
    const selfie = await storeUploadedSelfie(file, session.user.id, label, parentId);
    return NextResponse.json({ selfie });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The selfie could not be saved." }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import sharp from "sharp";
import { auth } from "@/lib/auth";
import { assessmentPhotoSetForUser, readStoredSelfie } from "@/lib/selfie-store";
import { parseSkinProfile } from "@/lib/skin-profile";
import { saveSkinProfileForUser, skinProfileForUser } from "@/lib/skin-profile-store";
import { SKIN_CONCERNS } from "@/lib/skin-profile-types";
import { runYouCamTask, uploadYouCamFiles } from "@/lib/youcam";

export const runtime = "nodejs";
export const maxDuration = 120;

function isFaceTooSmallError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("error_face_position_too_small")
    || message.includes("face in the input image is too small")
    || message.includes("more than 60%");
}

async function runSkinAnalysis(image: Buffer, filename: string) {
  const file = new File([new Uint8Array(image)], filename, { type: "image/jpeg" });
  const [fileId] = await uploadYouCamFiles("skin-analysis", [file], "v2.1");
  return runYouCamTask("skin-analysis", {
    src_file_id: fileId,
    dst_actions: [...SKIN_CONCERNS],
    format: "json",
    pf_camera_kit: false,
  }, "v2.1", 55_000);
}

function readableSkinError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Skin Analysis could not be completed.";
  const message = raw.toLowerCase();
  if (message.includes("credit") && (message.includes("not enough") || message.includes("insufficient") || message.includes("doesn't have enough"))) {
    return { status: 402, code: "youcam_credit_error", message: "Muse’s YouCam account does not have enough units for Skin Analysis. Your selfie is not the problem." };
  }
  if (isFaceTooSmallError(error)) return { status: 422, code: "skin_selfie_too_far", message: "Muse tried a dedicated close portrait crop, but YouCam still needs more facial detail for Skin Analysis. Recalibrate with a closer front photo." };
  if (message.includes("error_face_position_out_of_boundary")) return { status: 422, code: "skin_selfie_cropped", message: "YouCam needs your complete face inside the frame. Recalibrate with a little more space around your forehead and chin." };
  if (message.includes("error_insufficient_lighting")) return { status: 422, code: "skin_selfie_lighting", message: "YouCam needs brighter, more even light for Skin Analysis. Recalibrate in soft light without strong shadows." };
  if (message.includes("error_face_angle") || message.includes("forward")) return { status: 422, code: "skin_selfie_angle", message: "YouCam needs a straight, front-facing neutral photo for Skin Analysis. Recalibrate while looking directly into the camera." };
  if (message.includes("api key") || message.includes("permission") || message.includes("access")) return { status: 503, code: "youcam_connection_error", message: "Muse cannot access YouCam Skin Analysis right now. Your selfie may be perfectly usable." };
  return { status: 502, code: "youcam_skin_error", message: raw };
}

async function currentAssessment(userId: string) {
  const photoSet = await assessmentPhotoSetForUser(userId);
  if (!photoSet) throw new Error("Complete your Muse assessment before running Skin Analysis.");
  const original = photoSet.face;
  if (original.sourceKind !== "upload" || original.makeup || original.hair) {
    throw new Error("Muse could not identify an untouched original assessment selfie. Please recalibrate before running Skin Analysis.");
  }
  return original;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to view your saved Skin Analysis." }, { status: 401 });
  try {
    const [assessment, profile] = await Promise.all([
      currentAssessment(session.user.id),
      skinProfileForUser(session.user.id),
    ]);
    if (!profile || profile.assessmentSelfieId !== assessment.id) {
      return NextResponse.json({ profile: null, assessmentSelfieId: assessment.id, source: "original-assessment-selfie" });
    }
    return NextResponse.json({ profile, assessmentSelfieId: assessment.id, source: "original-assessment-selfie" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Your saved Skin Analysis could not be loaded." }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to run Skin Analysis." }, { status: 401 });

  try {
    const assessment = await currentAssessment(session.user.id);
    const cached = await skinProfileForUser(session.user.id);
    if (cached?.assessmentSelfieId === assessment.id) {
      return NextResponse.json({ profile: cached, cached: true, source: "original-assessment-selfie" });
    }

    const stored = await readStoredSelfie(assessment.id, session.user.id);
    if (!stored) throw new Error("Your current assessment selfie could not be read. Please recalibrate and try again.");
    const input = Buffer.from(await new Response(stored.result.stream).arrayBuffer());
    const prepared = await sharp(input)
      .rotate()
      .resize({ width: 960, height: 1200, fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
      .toBuffer();
    let result;
    try {
      result = await runSkinAnalysis(prepared, "muse-skin-analysis.jpg");
    } catch (error) {
      if (!isFaceTooSmallError(error)) throw error;

      // Skin Analysis requires the face to occupy more than 60% of the image
      // width. A 1.4x retry was not enough for otherwise valid, wider
      // assessment portraits. Retry at 2x with a slight upward bias so the
      // forehead and chin remain inside the frame. This never alters the
      // original selfie stored in the member's photo library.
      const tighter = await sharp(prepared)
        .resize({ width: 1920, height: 2400 })
        .extract({ left: 480, top: 300, width: 960, height: 1200 })
        .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
        .toBuffer();
      result = await runSkinAnalysis(tighter, "muse-skin-analysis-close.jpg");
    }
    const profile = parseSkinProfile(result, assessment.id);
    await saveSkinProfileForUser(session.user.id, profile);
    return NextResponse.json({ profile, cached: false, source: "original-assessment-selfie" });
  } catch (error) {
    const readable = readableSkinError(error);
    return NextResponse.json({ error: readable.message, code: readable.code }, { status: readable.status });
  }
}

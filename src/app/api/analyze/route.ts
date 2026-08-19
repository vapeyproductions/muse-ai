import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { demoAnalysis } from "@/lib/demo-analysis";
import type { UserAnalysis } from "@/lib/muse-types";
import { analyzeSingleFile, uploadYouCamFiles, runYouCamTask } from "@/lib/youcam";

export const runtime = "nodejs";
export const maxDuration = 60;

type DetectorName = "fitzpatrick" | "colors" | "face";
type TaskData = Awaited<ReturnType<typeof analyzeSingleFile>>;
type DetectorReport = {
  id: DetectorName;
  label: string;
  status: "completed" | "failed";
  issue?: string;
};
type PhotoQuality = {
  status: "passed" | "warning";
  kind?: "photo" | "service";
  summary: string;
  checks: string[];
};

const DETECTOR_LABELS: Record<DetectorName, string> = {
  fitzpatrick: "Fitzpatrick skin type",
  colors: "Facial color tones",
  face: "Face attributes & ratios",
};

const FACE_ATTRIBUTE_FEATURES = [
  "faceShape", "eyeShape", "eyeSize", "eyeAngle", "eyeDistance", "eyelid",
  "eyebrowShape", "eyebrowThickness", "eyebrowDistance", "eyebrowShortness", "lipShape",
  "noseWidth", "noseLength", "cheekbones",
];

const MATCH_FACE_FIELDS: Array<keyof UserAnalysis> = [
  "faceShape", "eyeShape", "eyeSize", "eyeAngle", "eyeSpacing", "eyelidType",
  "eyebrowShape", "eyebrowThickness", "eyebrowSpacing", "eyebrowLength",
  "lipShape", "noseWidth", "noseLength", "cheekbones",
];

const get = (value: unknown, path: string) => path.split(".").reduce<unknown>((current, key) => {
  if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
  return undefined;
}, value);

const first = (...values: unknown[]) => values.find((value) => value !== undefined && value !== null && value !== "");
const stringValue = (fallback: string, ...values: unknown[]) => String(first(...values) ?? fallback);
const UNKNOWN = "Unknown";

function isCreditFailure(value: string) {
  const message = value.toLowerCase();
  const mentionsBalance = message.includes("credit") || message.includes("unit");
  const saysNotEnough = message.includes("insufficient")
    || message.includes("not enough")
    || message.includes("doesn't have enough")
    || message.includes("does not have enough");
  return mentionsBalance && saysNotEnough;
}

function hairColorValue(colors: Record<string, unknown> | undefined) {
  const reported = stringValue(UNKNOWN, colors?.hair_color_name);
  const hex = String(colors?.hair_color ?? "");
  const match = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!match) return reported;
  const [red, green, blue] = match.slice(1).map((value) => Number.parseInt(value, 16));
  const luminance = red * .2126 + green * .7152 + blue * .0722;

  // YouCam occasionally labels dark highlighted/ombré hair as Blonde. Keep
  // its categorical result unless it directly conflicts with its own sampled
  // hair hex, which is the more useful signal for recommendation matching.
  if (reported.toLowerCase() === "blonde" && luminance < 125) {
    return luminance < 55 ? "Black" : "Brown";
  }
  return reported;
}

function readableYouCamIssue(value: string) {
  const message = value.toLowerCase();
  if (message.includes("api key isn't recognized") || message.includes("api key is not configured") || message.includes("api_key") && message.includes("invalid")) return "Muse’s YouCam API key is invalid. Your photos are not the problem.";
  if (message.includes("does not have access") || message.includes("permission") && message.includes("api")) return "Muse’s YouCam account does not currently have access to this detector. Your photos are not the problem.";
  if (isCreditFailure(value)) return "Muse’s YouCam account does not have enough units to run this analysis. Your photos are not the problem.";
  if (message.includes("error_below_min_image_size")) return "A photo is too small. Use an image at least 320 × 320 pixels.";
  if (message.includes("error_face_position_too_small")) return "Your face is too small in one photo. Use a closer crop or retake it closer to the camera.";
  if (message.includes("error_face_position_out_of_boundary")) return "Your face or hair leaves the frame in one photo. Center yourself and keep the full outline visible.";
  if (message.includes("error_face_position_invalid")) return "YouCam could not see your entire face clearly in one photo.";
  if (message.includes("error_face_not_forward_facing")) return "The front photo is not facing the camera directly enough for YouCam.";
  if (message.includes("error_insufficient_lighting")) return "One photo needs brighter, more even light across your face.";
  if (message.includes("error_face_angle_downward")) return "The front photo is angled slightly downward. Lift your chin and look directly into the camera.";
  if (message.includes("error_face_angle_upward")) return "The front photo is angled slightly upward. Lower your chin and look directly into the camera.";
  if (message.includes("error_face_angle_leftward")) return "The front photo is turned slightly left. Face the camera more directly.";
  if (message.includes("error_face_angle_rightward")) return "The front photo is turned slightly right. Face the camera more directly.";
  if (message.includes("error_face_angle_left_tilt")) return "The front photo is tilted left. Keep your head level.";
  if (message.includes("error_face_angle_right_tilt")) return "The front photo is tilted right. Keep your head level.";
  if (message.includes("error_face_attributes_incomplete")) return "YouCam returned too few facial measurements to calculate trustworthy celebrity matches. Please retry the analysis.";
  if (message.includes("error_face_angle_invalid")) return "Your head angle is outside YouCam’s accepted range. Keep the front view straight and your chin level.";
  if (message.includes("expected pattern") || message.includes("invalid upload url") || message.includes("invalid upload headers")) return "YouCam could not read one of the prepared photo uploads. Muse has repaired the upload format; please try once more.";
  if (message.includes("timed out")) return "YouCam took too long to read one of the photos. You can retry without replacing them.";
  return "YouCam returned an unrecognized detector error. Muse could not determine that your photos were at fault.";
}

function detectorWarningParts(value: string) {
  const match = value.match(/^(fitzpatrick|colors|face):\s*(.*)$/i);
  if (!match) return { detail: value };
  const id = (Object.keys(DETECTOR_LABELS) as DetectorName[])
    .find((name) => name.toLowerCase() === match[1].toLowerCase());
  return { id, detail: match[2] };
}

function readableDetectorIssue(value: string) {
  const { id, detail } = detectorWarningParts(value);
  const issue = readableYouCamIssue(detail);
  return id ? `${DETECTOR_LABELS[id]}: ${issue}` : issue;
}

function isServiceFailure(value: string) {
  const message = value.toLowerCase();
  const knownPhotoFailure = message.includes("error_below_min_image_size")
    || message.includes("error_face_position")
    || message.includes("error_face_not_forward_facing")
    || message.includes("error_insufficient_lighting")
    || message.includes("error_face_angle")
    || message.includes("error_mismatch_image_size");
  if (knownPhotoFailure) return false;
  return true;
}

function qualityFromWarnings(warnings: string[]): PhotoQuality {
  if (!warnings.length) {
    return {
      status: "passed",
      summary: "All three YouCam analysis detectors completed successfully.",
      checks: ["Fitzpatrick completed", "Color tones completed", "Face attributes completed"],
    };
  }
  const checks = [...new Set(warnings.map(readableDetectorIssue))];
  const serviceFailure = warnings.some(isServiceFailure);
  const creditFailure = warnings.some(isCreditFailure);
  return {
    status: "warning",
    kind: serviceFailure ? "service" : "photo",
    summary: creditFailure
      ? "Muse’s YouCam account does not have enough units to complete the assessment. Your photos are not the problem."
      : serviceFailure
      ? "One or more YouCam services could not complete the request. Your photos may be perfectly usable."
      : "The Camera Kit accepted the capture, but one or more analysis detectors applied a different rule. Completed results are still usable.",
    checks,
  };
}

function fitzpatrickValue(result: TaskData | undefined) {
  const candidates = [
    get(result, "results.fitzpatrick_scale"),
    get(result, "results.fitzpatrick"),
    get(result, "results.fitzpatrick_type"),
    get(result, "results.skin_type"),
    get(result, "results.type"),
    get(result, "results.output.0.type"),
    get(result, "results.output.0.fitzpatrick"),
  ];
  const raw = first(...candidates);
  if (typeof raw === "number" && raw >= 1 && raw <= 6) return raw;
  const match = String(raw ?? JSON.stringify(result?.results ?? {})).match(/(?:type[\s_-]*)?(VI|IV|V|III|II|I|[1-6])\b/i);
  if (!match) return 0;
  const roman: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  return roman[match[1].toUpperCase()] ?? Number(match[1]);
}

function normalizedAnalysis(results: Partial<Record<DetectorName, TaskData>>): UserAnalysis {
  const colors = results.colors?.results?.color as Record<string, unknown> | undefined;
  const face = results.face?.results as Record<string, unknown> | undefined;
  const lipShape = first(get(face, "lipshape.0"), get(face, "lipshape"));

  return {
    age: Number(first(get(face, "agegender.age"), 0)),
    gender: stringValue(UNKNOWN, get(face, "agegender.gender")),
    fitzpatrick: fitzpatrickValue(results.fitzpatrick),
    skinColor: stringValue("", colors?.skin_color),
    eyeColor: stringValue(UNKNOWN, colors?.eye_color_name),
    lipColor: stringValue("", colors?.lip_color),
    eyebrowColor: stringValue(UNKNOWN, colors?.eyebrow_color),
    hairColor: hairColorValue(colors),
    faceShape: stringValue(UNKNOWN, get(face, "faceshape")),
    eyeShape: stringValue(UNKNOWN, get(face, "eyelid.left_shape"), get(face, "eyelid.right_shape")),
    eyeSize: stringValue(UNKNOWN, get(face, "eyelid.size")),
    eyeAngle: stringValue(UNKNOWN, get(face, "eyelid.left_angle"), get(face, "eyelid.right_angle")),
    eyeSpacing: stringValue(UNKNOWN, get(face, "eyelid.setting")),
    eyelidType: stringValue(UNKNOWN, get(face, "eyelid.left_eyelid"), get(face, "eyelid.right_eyelid")),
    eyebrowShape: stringValue(UNKNOWN, get(face, "eyebrow.left_shape"), get(face, "eyebrow.right_shape")),
    eyebrowThickness: stringValue(UNKNOWN, get(face, "eyebrow.left_body_thickness"), get(face, "eyebrow.right_body_thickness")),
    eyebrowSpacing: stringValue(UNKNOWN, get(face, "eyebrow.gap")),
    eyebrowLength: stringValue(UNKNOWN, get(face, "eyebrow.left_shortness"), get(face, "eyebrow.right_shortness")),
    lipShape: stringValue(UNKNOWN, lipShape),
    noseWidth: stringValue(UNKNOWN, get(face, "nose.width")),
    noseLength: stringValue(UNKNOWN, get(face, "nose.length")),
    cheekbones: stringValue(UNKNOWN, get(face, "cheekbone.overrall"), get(face, "cheekbone.overall")),
    source: "youcam",
  };
}

function hasMatchableFaceProfile(analysis: UserAnalysis) {
  const available = MATCH_FACE_FIELDS.filter((field) => {
    const value = String(analysis[field] ?? "").trim().toLowerCase();
    return value && value !== "unknown" && value !== "unavailable";
  });
  return available.length >= 8;
}

function requireFile(form: FormData, name: string) {
  const file = form.get(name);
  if (!(file instanceof File) || !file.size) throw new Error(`Missing ${name} photo.`);
  if (file.size > 10 * 1024 * 1024) throw new Error(`${name} must be under 10 MB.`);
  return file;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Sign in to analyze your profile." }, { status: 401 });
  }

  if (!process.env.YOUCAM_API_KEY) {
    return NextResponse.json({ analysis: demoAnalysis, mode: "demo", warnings: ["YOUCAM_API_KEY is not configured; sample analysis returned."] });
  }

  try {
    const form = await request.formData();
    const face = requireFile(form, "face");

    const jobs: Record<DetectorName, Promise<TaskData>> = {
      fitzpatrick: analyzeSingleFile("fitzpatrick-scale-analyzer", face, (fileId) => ({
        src_file_id: fileId,
        version: "1.0",
        index: 0,
      })),
      colors: analyzeSingleFile("skin-tone-analysis", face, (fileId) => ({
        src_file_id: fileId,
        face_angle_strictness_level: "flexible",
      })),
      face: (async () => {
        const [fileId] = await uploadYouCamFiles("face-attr-analysis", [face]);
        return runYouCamTask("face-attr-analysis", {
          src_file_id: fileId,
          features: FACE_ATTRIBUTE_FEATURES,
          face_angle_strictness_level: "flexible",
        });
      })(),
    };

    const names = Object.keys(jobs) as DetectorName[];
    const settled = await Promise.allSettled(names.map((name) => jobs[name]));
    const complete: Partial<Record<DetectorName, TaskData>> = {};
    const failureDetails: Partial<Record<DetectorName, string>> = {};
    const warnings: string[] = [];
    settled.forEach((result, index) => {
      const name = names[index];
      if (result.status === "fulfilled") complete[name] = result.value;
      else {
        const detail = result.reason instanceof Error ? result.reason.message : "failed";
        failureDetails[name] = detail;
        warnings.push(`${name}: ${detail}`);
        console.error("[api/analyze] detector failed", { detector: name, error: detail });
      }
    });
    const detectors: DetectorReport[] = names.map((name) => ({
      id: name,
      label: DETECTOR_LABELS[name],
      status: complete[name] ? "completed" : "failed",
      ...(failureDetails[name] ? { issue: readableYouCamIssue(failureDetails[name]!) } : {}),
    }));
    if (Object.keys(complete).length === 0) {
      const quality = qualityFromWarnings(warnings);
      const serviceFailure = quality.kind === "service";
      const creditFailure = warnings.some(isCreditFailure);
      return NextResponse.json({
        error: creditFailure
          ? "Muse’s YouCam account does not have enough units to run the required detectors."
          : serviceFailure
          ? "None of the three YouCam services completed this request. Your photo may not be the cause."
          : "None of the three YouCam detectors accepted this photo. Review the detector details below.",
        code: creditFailure ? "youcam_credit_error" : serviceFailure ? "youcam_service_error" : "photo_quality_error",
        quality,
        detectors,
      }, { status: serviceFailure ? 502 : 422 });
    }
    const analysis = normalizedAnalysis(complete);
    const matchReady = Boolean(complete.face) && hasMatchableFaceProfile(analysis);
    if (complete.face && !matchReady) {
      warnings.push("face: error_face_attributes_incomplete");
      const faceReport = detectors.find((detector) => detector.id === "face");
      if (faceReport) faceReport.issue = readableYouCamIssue("error_face_attributes_incomplete");
    }
    return NextResponse.json({
      analysis,
      warnings,
      quality: qualityFromWarnings(warnings),
      matchReady,
      completedDetectors: names.filter((name) => Boolean(complete[name])),
      detectors,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Analysis could not be completed.";
    const readable = readableYouCamIssue(detail);
    const serviceFailure = isServiceFailure(detail);
    console.error("[api/analyze] request failed", { error: detail, serviceFailure });
    return NextResponse.json({
      error: readable,
      code: serviceFailure ? "youcam_service_error" : "photo_quality_error",
      quality: {
        status: "warning",
        kind: serviceFailure ? "service" : "photo",
        summary: serviceFailure
          ? "Muse could not complete the YouCam connection."
          : "YouCam could not approve these photos yet.",
        checks: [readable],
      } satisfies PhotoQuality,
    }, { status: serviceFailure ? 502 : 422 });
  }
}

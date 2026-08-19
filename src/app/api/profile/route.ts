import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteMuseProfileForUser, museProfileForUser, saveMuseProfileForUser } from "@/lib/profile-store";
import type { MuseMatchSnapshot, SavedMuseProfile } from "@/lib/profile-types";
import { REPRESENTATION_OPTIONS, type RepresentationTag } from "@/lib/muse-representation";
import type { UserAnalysis } from "@/lib/muse-types";
import { deleteSkinProfileForUser } from "@/lib/skin-profile-store";
import { clearCurrentAssessmentForUser } from "@/lib/selfie-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

const REPRESENTATION_TAGS = new Set<string>(REPRESENTATION_OPTIONS.map(({ id }) => id));

function validAnalysis(value: unknown): value is UserAnalysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UserAnalysis>;
  return typeof candidate.faceShape === "string"
    && typeof candidate.eyeShape === "string"
    && typeof candidate.skinColor === "string"
    && Number.isFinite(Number(candidate.fitzpatrick));
}

function validMatches(value: unknown): value is MuseMatchSnapshot[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 5
    && value.every((match) => match
      && typeof match.museId === "string"
      && Number.isFinite(match.score)
      && Number.isFinite(match.featureScore)
      && Number.isFinite(match.representationScore)
      && Array.isArray(match.reasons)
      && match.reasons.every((reason: unknown) => typeof reason === "string"));
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to access your Muse profile." }, { status: 401, headers: PRIVATE_NO_STORE });
  const profile = await museProfileForUser(session.user.id);
  if (!profile) return NextResponse.json({ error: "No saved Muse profile yet." }, { status: 404, headers: PRIVATE_NO_STORE });
  return NextResponse.json({ profile }, { headers: PRIVATE_NO_STORE });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to save your Muse profile." }, { status: 401 });

  try {
    const body = await request.json() as Partial<SavedMuseProfile>;
    const preferences = Array.isArray(body.representationPreferences)
      ? [...new Set(body.representationPreferences.filter((tag): tag is RepresentationTag => REPRESENTATION_TAGS.has(String(tag))))]
      : [];
    if (!validAnalysis(body.analysis)) throw new Error("The completed facial analysis is invalid.");
    if (!validMatches(body.matches)) throw new Error("The celebrity match snapshot is invalid.");
    if (typeof body.catalogVersion !== "string" || !body.catalogVersion) throw new Error("The Muse catalog version is missing.");

    const profile = await saveMuseProfileForUser(session.user.id, {
      analysis: body.analysis,
      representationPreferences: preferences,
      matches: body.matches,
      catalogVersion: body.catalogVersion.slice(0, 80),
    });
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Your Muse profile could not be saved." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in to recalibrate your Muse profile." }, { status: 401 });
  await Promise.all([
    deleteMuseProfileForUser(session.user.id),
    deleteSkinProfileForUser(session.user.id),
  ]);
  await clearCurrentAssessmentForUser(session.user.id);
  return NextResponse.json({ deleted: true });
}

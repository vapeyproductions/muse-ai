import {
  SKIN_CONCERNS,
  type SavedSkinProfile,
  type SkinConcernName,
  type SkinConcernResult,
} from "@/lib/skin-profile-types";
import type { YouCamTaskResult } from "@/lib/youcam";

type JsonObject = Record<string, unknown>;

const LABELS: Record<SkinConcernName, string> = {
  skin_type: "Skin type",
  acne: "Blemish clarity",
  moisture: "Moisture",
  oiliness: "Oil balance",
  redness: "Redness",
  texture: "Texture",
  pore: "Pore visibility",
};

const ADVICE: Record<SkinConcernName, string> = {
  skin_type: "Build the routine around how your skin behaves after cleansing, then adjust textures seasonally.",
  acne: "Keep cleansing gentle, choose non-comedogenic formulas, and introduce one blemish-focused active at a time.",
  moisture: "Layer a humectant serum under moisturizer while skin is slightly damp, then use a richer barrier cream when needed.",
  oiliness: "Use lightweight hydration and avoid over-cleansing; stripping the skin can make shine feel harder to balance.",
  redness: "Favor fragrance-free, soothing formulas and pause new actives if the skin feels hot, tight, or irritated.",
  texture: "Introduce gentle exfoliation gradually, patch test first, and prioritize hydration on the nights between treatments.",
  pore: "Consistent sunscreen, balanced hydration, and gradual exfoliation can soften the visible contrast around pores.",
};

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function finiteScore(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : null;
}

function stringValue(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function concernResult(type: SkinConcernName, entry: JsonObject): SkinConcernResult {
  const score = objectValue(entry.score);
  const whole = objectValue(entry.whole);
  const value = stringValue(
    entry.value,
    entry.term,
    entry.skin_type,
    score?.value,
    score?.term,
    whole?.value,
    whole?.term,
    whole?.skin_type,
  );
  return {
    type,
    label: LABELS[type],
    uiScore: finiteScore(
      entry.ui_score
      ?? entry.uiScore
      ?? score?.ui_score
      ?? score?.uiScore
      ?? whole?.ui_score
      ?? whole?.uiScore
      ?? entry.score,
    ),
    rawScore: finiteScore(
      entry.raw_score
      ?? entry.rawScore
      ?? score?.raw_score
      ?? score?.rawScore
      ?? whole?.raw_score
      ?? whole?.rawScore,
    ),
    ...(value ? { value } : {}),
  };
}

function collectEntries(result: YouCamTaskResult) {
  const results = objectValue(result.results) || {};
  const output = Array.isArray(results.output) ? results.output : [];
  const entries = new Map<SkinConcernName, JsonObject>();

  output.forEach((item) => {
    const entry = objectValue(item);
    const type = entry && stringValue(entry.type, entry.name);
    if (type && SKIN_CONCERNS.includes(type as SkinConcernName)) entries.set(type as SkinConcernName, entry);
  });
  SKIN_CONCERNS.forEach((type) => {
    const direct = objectValue(results[type]);
    if (direct && !entries.has(type)) entries.set(type, direct);
  });
  return { results, entries };
}

function buildSummary(skinType: string | null, concerns: SkinConcernResult[]) {
  const scored = concerns
    .filter((concern) => concern.type !== "skin_type" && concern.uiScore !== null)
    .sort((left, right) => (left.uiScore || 0) - (right.uiScore || 0));
  const strengths = [...scored].reverse().slice(0, 2).map((concern) => concern.label.toLowerCase());
  const priorities = scored.slice(0, 2).map((concern) => concern.label.toLowerCase());
  const typeIntro = skinType ? `YouCam reads your skin as ${skinType}. ` : "";
  if (!scored.length) return `${typeIntro}Your result is saved, but YouCam did not return comparable scores for the selected concerns.`;
  return `${typeIntro}${strengths.length ? `Your strongest signals are ${strengths.join(" and ")}. ` : ""}${priorities.length ? `The clearest routine opportunities are ${priorities.join(" and ")}.` : ""}`.trim();
}

export function parseSkinProfile(result: YouCamTaskResult, assessmentSelfieId: string): SavedSkinProfile {
  const { results, entries } = collectEntries(result);
  const concerns = SKIN_CONCERNS.flatMap((type) => {
    const entry = entries.get(type);
    return entry ? [concernResult(type, entry)] : [];
  });
  if (!concerns.length) throw new Error("YouCam completed Skin Analysis but returned no readable concern scores.");
  const typeConcern = concerns.find((concern) => concern.type === "skin_type");
  const skinType = typeConcern?.value || stringValue(results.skin_type, objectValue(results.skin_type)?.value) || null;
  const numericScores = concerns.flatMap((concern) => concern.uiScore === null || concern.type === "skin_type" ? [] : [concern.uiScore]);
  const overallScore = finiteScore(results.ui_score ?? results.overall_score ?? objectValue(results.all)?.score)
    ?? (numericScores.length ? Math.round(numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length) : null);
  const priorities = concerns
    .filter((concern) => concern.type !== "skin_type" && concern.uiScore !== null)
    .sort((left, right) => (left.uiScore || 0) - (right.uiScore || 0))
    .slice(0, 3);

  return {
    assessmentSelfieId,
    skinType,
    overallScore,
    concerns,
    summary: buildSummary(skinType, concerns),
    advice: [
      ...priorities.map((concern) => ADVICE[concern.type]),
      "Finish every morning with broad-spectrum SPF, and introduce unfamiliar products one at a time so you can read your skin's response.",
    ],
    generatedAt: new Date().toISOString(),
  };
}

export function skinPriorityTags(profile: SavedSkinProfile) {
  return profile.concerns
    .filter((concern) => concern.type !== "skin_type" && concern.uiScore !== null)
    .sort((left, right) => (left.uiScore || 0) - (right.uiScore || 0))
    .slice(0, 4)
    .map((concern) => concern.type);
}

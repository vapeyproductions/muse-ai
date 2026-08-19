import type {
  LookKind,
  Muse,
  MuseCatalog,
  MuseLook,
  MuseMatch,
  UserAnalysis,
} from "./muse-types";
import { MUSE_REPRESENTATION_TAGS, type RepresentationTag } from "./muse-representation";

type WeightedField = [keyof UserAnalysis, number, string];

const MATCH_GROUPS: Array<{ share: number; fields: WeightedField[] }> = [
  {
    // These are the identity-defining signals shown to the user. They determine
    // almost all of the score; secondary details only break close ties.
    share: .92,
    fields: [
      ["faceShape", 14, "face shape"],
      ["cheekbones", 14, "cheekbone structure"],
      ["eyeShape", 13, "eye shape"],
      ["eyeSize", 11, "eye size"],
      ["noseWidth", 10, "nose width"],
      ["noseLength", 8, "nose length"],
      ["fitzpatrick", 13, "skin tone range"],
      ["eyeColor", 9, "eye color"],
      ["hairColor", 8, "hair color"],
    ],
  },
  {
    share: .08,
    fields: [
      ["lipShape", 5, "lip shape"],
      ["eyeSpacing", 4, "eye spacing"],
      ["eyebrowShape", 4, "brow shape"],
      ["eyeAngle", 3, "eye angle"],
      ["eyelidType", 3, "eyelid type"],
      ["eyebrowThickness", 2, "brow density"],
      ["eyebrowSpacing", 2, "brow spacing"],
      ["eyebrowLength", 1, "brow length"],
      ["eyebrowColor", 1, "brow color"],
    ],
  },
];

const FEATURE_SCORE_SHARE = .78;
const REPRESENTATION_SCORE_SHARE = .22;
const MIN_SHARED_REPRESENTATION_MATCHES = 3;

const ASIAN_REPRESENTATION_TAGS = new Set<RepresentationTag>([
  "east-asian",
  "south-asian",
  "southeast-asian",
]);

const AESTHETIC_TAGS: Record<string, string[]> = {
  Minimal: ["natural", "neutral lip", "neutral shadow", "natural mascara", "slick back"],
  Romantic: ["soft pink blush", "pink", "glossy", "bouncy curls", "face frame"],
  Editorial: ["dramatic blush", "white shadow", "blue", "slick back", "volume"],
  Classic: ["red lip", "cat eye", "bun", "bouncy curls", "side part"],
  "Soft glam": ["natural glam", "fluffy lash", "glossy", "shimmer", "volume"],
  Experimental: ["violette", "white", "blue", "dramatic blush", "braids"],
  "90s": ["dark lip", "fully lined", "smokey", "straight", "middle part"],
  Coquette: ["pink", "soft pink blush", "glossy", "half up half down", "bangs"],
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

function hasUsableValue(field: keyof UserAnalysis, value: unknown) {
  if (field === "fitzpatrick") {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1 && numeric <= 6;
  }
  const normalized = normalize(value);
  return Boolean(normalized) && normalized !== "unknown" && normalized !== "unavailable";
}

function featureSimilarity(field: keyof UserAnalysis, userValue: unknown, museValue: unknown) {
  if (field === "fitzpatrick") {
    const difference = Math.abs(Number(userValue) - Number(museValue));
    return difference === 0 ? 1 : difference === 1 ? 0.55 : difference === 2 ? 0.2 : 0;
  }
  return normalize(userValue) === normalize(museValue) ? 1 : 0;
}

function representationSimilarity(muse: Muse, preferences: RepresentationTag[]) {
  if (!preferences.length) return .5;
  const museTags = new Set(MUSE_REPRESENTATION_TAGS[muse.id] || []);
  return Math.max(...preferences.map((preference) => {
    if (museTags.has(preference)) return 1;

    // The assessment lets people self-identify more precisely than the current
    // catalog can always support. Treat the Asian identities as one broader
    // representation cohort for shortlist coverage, while preserving a clear
    // scoring advantage for an exact East/South/Southeast Asian match.
    if (
      ASIAN_REPRESENTATION_TAGS.has(preference)
      && [...museTags].some((tag) => ASIAN_REPRESENTATION_TAGS.has(tag))
    ) return .72;

    return 0;
  }));
}

function fitzpatrickEligibilityWindow(value: unknown): [number, number] | null {
  const skinType = Math.round(Number(value));
  if (!Number.isFinite(skinType) || skinType < 1 || skinType > 6) return null;
  if (skinType <= 2) return [1, 3];
  if (skinType >= 5) return [4, 6];
  return [skinType - 1, skinType + 1];
}

export function matchMuses(
  catalog: MuseCatalog,
  analysis: UserAnalysis,
  representationPreferences: RepresentationTag[],
  limit = 6,
): MuseMatch[] {
  const skinWindow = fitzpatrickEligibilityWindow(analysis.fitzpatrick);
  const eligibleMuses = skinWindow
    ? catalog.muses.filter((muse) => {
        const museSkinType = Number(muse.features.fitzpatrick);
        return Number.isFinite(museSkinType)
          && museSkinType >= skinWindow[0]
          && museSkinType <= skinWindow[1];
      })
    : catalog.muses;

  const ranked = eligibleMuses
    .map((muse) => {
      let groupedScore = 0;
      let availableGroupShare = 0;
      const matched: Array<{ label: string; weight: number }> = [];
      MATCH_GROUPS.forEach(({ share, fields }) => {
        let availableWeight = 0;
        let weightedScore = 0;
        fields.forEach(([field, weight, label]) => {
          const userValue = analysis[field];
          const museValue = muse.features[field as keyof typeof muse.features];
          if (!hasUsableValue(field, userValue) || !hasUsableValue(field, museValue)) return;
          const similarity = featureSimilarity(field, userValue, museValue);
          availableWeight += weight;
          weightedScore += similarity * weight;
          if (similarity === 1 && weight >= 4) matched.push({ label, weight: weight * share });
        });
        if (!availableWeight) return;
        groupedScore += (weightedScore / availableWeight) * share;
        availableGroupShare += share;
      });
      const featureScore = availableGroupShare ? groupedScore / availableGroupShare : 0;
      const representationScore = representationSimilarity(muse, representationPreferences);
      if (representationPreferences.length && representationScore > 0) {
        matched.push({ label: "shared background", weight: representationScore * 22 });
      }
      const score = representationPreferences.length
        ? featureScore * FEATURE_SCORE_SHARE + representationScore * REPRESENTATION_SCORE_SHARE
        : featureScore;
      return {
        muse,
        score: Math.round(score * 100),
        featureScore,
        representationScore,
        reasons: matched
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 3)
          .map(({ label }) => label),
      };
    })
    .sort((a, b) => b.score - a.score || a.muse.name.localeCompare(b.muse.name));

  if (!representationPreferences.length) return ranked.slice(0, limit);

  // Facial structure and coloring still determine 78% of every score. This
  // composition rule prevents the much larger white/European catalog cohort
  // from crowding a self-identified background out of all five results.
  const exactRepresentation = ranked.filter((match) => match.representationScore === 1);
  const relatedRepresentation = ranked.filter((match) => (
    match.representationScore > 0 && match.representationScore < 1
  ));
  const represented = [...exactRepresentation, ...relatedRepresentation];
  const requiredCount = Math.min(MIN_SHARED_REPRESENTATION_MATCHES, limit, represented.length);
  const selected = represented.slice(0, requiredCount);
  const selectedIds = new Set(selected.map((match) => match.muse.id));
  ranked.forEach((match) => {
    if (selected.length >= limit || selectedIds.has(match.muse.id)) return;
    selected.push(match);
    selectedIds.add(match.muse.id);
  });
  return selected.sort((a, b) => b.score - a.score || a.muse.name.localeCompare(b.muse.name));
}

export type RecommendedLook = {
  look: MuseLook;
  muse: Muse;
  score: number;
};

export function recommendLooks(
  matches: MuseMatch[],
  kind: LookKind,
  aesthetics: string[],
  limit = 18,
): RecommendedLook[] {
  const desired = new Set(
    aesthetics.flatMap((aesthetic) => AESTHETIC_TAGS[aesthetic] ?? []).map(normalize),
  );
  return matches
    .flatMap((match, museIndex) =>
      match.muse.looks
        .filter((look) => look.kind === kind)
        .map((look) => {
          const tagHits = look.descriptors.filter((tag) => desired.has(normalize(tag))).length;
          return {
            look,
            muse: match.muse,
            score: match.score - museIndex * 1.5 + tagHits * 12 + Math.min(look.galleryAssetIds.length, 4),
          };
        }),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

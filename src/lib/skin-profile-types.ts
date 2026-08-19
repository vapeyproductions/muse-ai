export const SKIN_CONCERNS = [
  "skin_type",
  "acne",
  "moisture",
  "oiliness",
  "redness",
  "texture",
  "pore",
] as const;

export type SkinConcernName = typeof SKIN_CONCERNS[number];

export type SkinConcernResult = {
  type: SkinConcernName;
  label: string;
  uiScore: number | null;
  rawScore: number | null;
  value?: string;
};

export type SavedSkinProfile = {
  assessmentSelfieId: string;
  skinType: string | null;
  overallScore: number | null;
  concerns: SkinConcernResult[];
  summary: string;
  advice: string[];
  generatedAt: string;
};

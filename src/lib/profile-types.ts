import type { UserAnalysis } from "@/lib/muse-types";
import type { RepresentationTag } from "@/lib/muse-representation";

export type MuseMatchSnapshot = {
  museId: string;
  score: number;
  featureScore: number;
  representationScore: number;
  reasons: string[];
};

export type SavedMuseProfile = {
  analysis: UserAnalysis;
  representationPreferences: RepresentationTag[];
  matches: MuseMatchSnapshot[];
  catalogVersion: string;
  updatedAt: string;
};

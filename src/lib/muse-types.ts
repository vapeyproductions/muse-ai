export type LookKind = "makeup" | "hair";

export type MuseFeatures = {
  fitzpatrick: number;
  eyeColor: string;
  eyebrowColor: string;
  hairColor: string;
  hairLength: string;
  hairTypePrimary: string;
  hairTypeSecondary: string;
  hairTypeScore: number;
  faceShape: string;
  eyeShape: string;
  eyeSize: string;
  eyeAngle: string;
  eyeSpacing: string;
  eyelidType: string;
  eyebrowShape: string;
  eyebrowThickness: string;
  eyebrowSpacing: string;
  eyebrowLength: string;
  lipShape: string;
  noseWidth: string;
  noseLength: string;
  cheekbones: string;
};

export type MuseAsset = {
  id: string;
  imageUrl: string;
  transferImageUrl?: string;
  sourceUrl: string;
  width: number;
  height: number;
  approved: boolean;
};

export type MuseLook = {
  id: string;
  kind: LookKind;
  label: string;
  descriptors: string[];
  templateAssetId: string;
  galleryAssetIds: string[];
};

export type Muse = {
  id: string;
  name: string;
  features: MuseFeatures;
  introAssetIds: string[];
  looks: MuseLook[];
};

export type MuseCatalog = {
  version: string;
  stats: {
    muses: number;
    photoRecords: number;
    assets: number;
    looks: number;
  };
  assets: Record<string, MuseAsset>;
  muses: Muse[];
};

export type UserAnalysis = Omit<
  MuseFeatures,
  "hairLength" | "hairTypePrimary" | "hairTypeSecondary" | "hairTypeScore"
> & {
  age?: number;
  gender?: string;
  skinColor: string;
  lipColor: string;
  source: "demo" | "youcam";
};

export type MuseMatch = {
  muse: Muse;
  score: number;
  featureScore: number;
  representationScore: number;
  reasons: string[];
};

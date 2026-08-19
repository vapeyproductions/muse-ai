import type { OwnedProduct } from "@/lib/product-profile-types";
import type { SavedMuseProfile } from "@/lib/profile-types";
import type { PersistedSelfie } from "@/lib/selfie-client";
import type { SavedSkinProfile } from "@/lib/skin-profile-types";
import type { ShoppingItem } from "@/lib/shopping-store";

export const DEMO_BOARD_ACCOUNTS = {
  testing123: "User 1",
  testing12345: "User 2",
} as const;

export type DemoBoardAccount = keyof typeof DEMO_BOARD_ACCOUNTS;

export type DemoBoardSnapshot = {
  account: DemoBoardAccount;
  label: string;
  profile: SavedMuseProfile;
  selfies: PersistedSelfie[];
  assessmentSelfieId: string | null;
  skinProfile: SavedSkinProfile | null;
  shopping: {
    items: ShoppingItem[];
    affinityTags: Record<string, number>;
    visitedSourceKeys: string[];
  };
  ownedProducts: OwnedProduct[];
};

export function isDemoBoardAccount(value: string): value is DemoBoardAccount {
  return Object.prototype.hasOwnProperty.call(DEMO_BOARD_ACCOUNTS, value);
}

import "server-only";

import { databasePool } from "@/lib/auth";
import {
  DEMO_BOARD_ACCOUNTS,
  isDemoBoardAccount,
  type DemoBoardAccount,
  type DemoBoardSnapshot,
} from "@/lib/demo-board-types";
import { listOwnedProducts } from "@/lib/product-profile-store";
import { museProfileForUser } from "@/lib/profile-store";
import { assessmentPhotoSetForUser, selfiesForUser } from "@/lib/selfie-store";
import { shoppingStateForUser } from "@/lib/shopping-store";
import { skinProfileForUser } from "@/lib/skin-profile-store";

export async function demoBoardUser(account: string) {
  if (!isDemoBoardAccount(account)) return null;
  const result = await databasePool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE lower(username) = $1 LIMIT 1`,
    [account],
  );
  return result.rows[0] ? { id: result.rows[0].id, account } : null;
}

export async function loadDemoBoard(account: DemoBoardAccount): Promise<DemoBoardSnapshot | null> {
  const demoUser = await demoBoardUser(account);
  if (!demoUser) return null;
  const [profile, selfies, assessmentPhotos, skinProfile, shopping, ownedProducts] = await Promise.all([
    museProfileForUser(demoUser.id),
    selfiesForUser(demoUser.id),
    assessmentPhotoSetForUser(demoUser.id),
    skinProfileForUser(demoUser.id),
    shoppingStateForUser(demoUser.id),
    listOwnedProducts(demoUser.id),
  ]);
  if (!profile || !selfies.length) return null;
  const currentAssessmentId = assessmentPhotos?.face.id || null;
  const publicSelfies = selfies.map((selfie) => ({
    ...selfie,
    imageUrl: `/api/demo-board/selfies/${encodeURIComponent(selfie.id)}?account=${account}`,
    deletable: false,
  }));
  return {
    account,
    label: DEMO_BOARD_ACCOUNTS[account],
    profile,
    selfies: publicSelfies,
    assessmentSelfieId: currentAssessmentId,
    skinProfile,
    shopping,
    ownedProducts,
  };
}

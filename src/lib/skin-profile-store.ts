import { databasePool } from "@/lib/auth";
import type { SavedSkinProfile } from "@/lib/skin-profile-types";

type SkinProfileRow = {
  assessment_selfie_id: string;
  profile: SavedSkinProfile;
  updated_at: Date;
};

export async function skinProfileForUser(userId: string) {
  const result = await databasePool.query<SkinProfileRow>(
    `SELECT assessment_selfie_id, profile, updated_at
     FROM public.user_skin_profile
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.profile || null;
}

export async function saveSkinProfileForUser(userId: string, profile: SavedSkinProfile) {
  const result = await databasePool.query<SkinProfileRow>(
    `INSERT INTO public.user_skin_profile (user_id, assessment_selfie_id, profile, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET
       assessment_selfie_id = EXCLUDED.assessment_selfie_id,
       profile = EXCLUDED.profile,
       updated_at = now()
     RETURNING assessment_selfie_id, profile, updated_at`,
    [userId, profile.assessmentSelfieId, JSON.stringify(profile)],
  );
  return result.rows[0].profile;
}

export async function deleteSkinProfileForUser(userId: string) {
  await databasePool.query(`DELETE FROM public.user_skin_profile WHERE user_id = $1`, [userId]);
}

import { databasePool } from "@/lib/auth";
import type { SavedMuseProfile } from "@/lib/profile-types";

type MuseProfileRow = {
  analysis: SavedMuseProfile["analysis"];
  representation_preferences: SavedMuseProfile["representationPreferences"];
  matches: SavedMuseProfile["matches"];
  catalog_version: string;
  updated_at: Date;
};

function publicProfile(row: MuseProfileRow): SavedMuseProfile {
  return {
    analysis: row.analysis,
    representationPreferences: row.representation_preferences,
    matches: row.matches,
    catalogVersion: row.catalog_version,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function museProfileForUser(userId: string) {
  const result = await databasePool.query<MuseProfileRow>(
    `SELECT analysis, representation_preferences, matches, catalog_version, updated_at
     FROM public.user_muse_profile
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? publicProfile(result.rows[0]) : null;
}

export async function saveMuseProfileForUser(userId: string, profile: Omit<SavedMuseProfile, "updatedAt">) {
  const result = await databasePool.query<MuseProfileRow>(
    `INSERT INTO public.user_muse_profile
      (user_id, analysis, representation_preferences, matches, catalog_version, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       analysis = EXCLUDED.analysis,
       representation_preferences = EXCLUDED.representation_preferences,
       matches = EXCLUDED.matches,
       catalog_version = EXCLUDED.catalog_version,
       updated_at = now()
     RETURNING analysis, representation_preferences, matches, catalog_version, updated_at`,
    [
      userId,
      JSON.stringify(profile.analysis),
      JSON.stringify(profile.representationPreferences),
      JSON.stringify(profile.matches),
      profile.catalogVersion,
    ],
  );
  return publicProfile(result.rows[0]);
}

export async function deleteMuseProfileForUser(userId: string) {
  await databasePool.query(`DELETE FROM public.user_muse_profile WHERE user_id = $1`, [userId]);
}

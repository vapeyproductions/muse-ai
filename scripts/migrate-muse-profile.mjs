import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_muse_profile (
      user_id TEXT PRIMARY KEY,
      analysis JSONB NOT NULL,
      representation_preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
      matches JSONB NOT NULL,
      catalog_version TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("user_muse_profile migration complete");
} finally {
  await pool.end();
}

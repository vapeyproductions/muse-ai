import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    ALTER TABLE public.user_selfie
      ADD COLUMN IF NOT EXISTS makeup JSONB,
      ADD COLUMN IF NOT EXISTS hair JSONB
  `);
  console.log("user_selfie look provenance migration complete");
} finally {
  await pool.end();
}

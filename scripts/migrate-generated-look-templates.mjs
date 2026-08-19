import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.look_generated_template (
      look_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('makeup', 'hair')),
      status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'error')),
      blob_url TEXT,
      blob_pathname TEXT,
      content_type TEXT,
      access_token TEXT NOT NULL,
      source_reference_url TEXT NOT NULL,
      prompt TEXT NOT NULL,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS look_generated_template_status_idx
      ON public.look_generated_template (status, updated_at)
  `);
  console.log("look_generated_template migration complete");
} finally {
  await pool.end();
}

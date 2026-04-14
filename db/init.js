/**
 * Supabase client — shared across all routes.
 * Uses the service-role key so all server-side queries bypass RLS.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n  ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = { supabase };

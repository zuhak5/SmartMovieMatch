# Agent Instructions
- Do not reference, create, or interact with any database tables other than those explicitly defined in `supabase/migrations/supabase_tables_schema.sql`.
- Before adding or modifying any database access logic, verify that every referenced table name exists in `supabase/migrations/supabase_tables_schema.sql`; if it does not, treat it as an error.
- Ensure any code comments or documentation that mention tables also align with those defined in `supabase/migrations/supabase_tables_schema.sql`.
- Keep any Supabase policies, SQL functions, and seed data consistent with the table names and structures defined in `supabase/migrations/supabase_tables_schema.sql`.
- If existing code or tests reference a table missing from the schema file `supabase/migrations/supabase_tables_schema.sql` , resolve the mismatch as part of the change ( by correcting the code) and call it out in the PR summary.
Use only these API environment variables `api/apikey.sql`

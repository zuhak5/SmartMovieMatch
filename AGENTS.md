# Agent Instructions

## Database Safety Checklist
- Interact only with database tables defined in `supabase/migrations/supabase_tables_schema.sql`.
- Before adding or modifying database access logic, confirm every referenced table appears in `supabase/migrations/supabase_tables_schema.sql`; treat missing tables as errors to be fixed.
- Keep code comments and documentation in sync with the table names and structures found in the schema file defined in `supabase/migrations/supabase_tables_schema.sql`.
- Align any Supabase policies, SQL functions, and seed data with the definitions in `supabase/migrations/supabase_tables_schema.sql`.
- If existing code or tests reference a table absent from the schema file defined in `supabase/migrations/supabase_tables_schema.sql`., correct the code to resolve the mismatch and mention the fix in the PR summary.

## Environment Variables
- Use only the API environment variables declared in `api/apikey.sql` when writing configuration or documentation.

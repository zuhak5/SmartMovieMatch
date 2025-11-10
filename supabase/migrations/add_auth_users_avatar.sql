-- Adds avatar columns to auth_users if they do not exist
do $$ begin
  begin
    alter table public.auth_users add column avatar_path text null;
  exception when duplicate_column then
    null;
  end;
  begin
    alter table public.auth_users add column avatar_url text null;
  exception when duplicate_column then
    null;
  end;
end $$;

-- Creates social, diary, review, list, activity, and metadata tables for mini Letterboxd features.
-- These statements are idempotent via IF NOT EXISTS clauses or guarded blocks so the script can be rerun safely.

-- ---------------------------------------------------------------------------
-- FOLLOWS
-- ---------------------------------------------------------------------------
create table if not exists public.user_follows (
    follower_username text not null references public.auth_users(username) on delete cascade,
    followed_username text not null references public.auth_users(username) on delete cascade,
    status text not null default 'accepted' check (status in ('accepted', 'pending', 'blocked')),
    created_at timestamptz not null default timezone('utc', now()),
    constraint user_follows_pkey primary key (follower_username, followed_username),
    constraint user_follows_no_self_follow check (follower_username <> followed_username)
);

create index if not exists user_follows_followed_idx on public.user_follows (followed_username);
create index if not exists user_follows_follower_idx on public.user_follows (follower_username);

-- ---------------------------------------------------------------------------
-- MOVIES METADATA
-- ---------------------------------------------------------------------------
create table if not exists public.movies (
    imdb_id text primary key,
    tmdb_id text,
    title text not null,
    poster_url text,
    release_year smallint,
    runtime_minutes integer,
    genres text[],
    synopsis text,
    last_synced_at timestamptz not null default timezone('utc', now()),
    constraint movies_release_year_range check (release_year is null or release_year >= 1888),
    constraint movies_runtime_positive check (runtime_minutes is null or runtime_minutes > 0)
);

-- ---------------------------------------------------------------------------
-- WATCH DIARY
-- ---------------------------------------------------------------------------
create table if not exists public.watch_diary (
    id uuid primary key default gen_random_uuid(),
    username text not null references public.auth_users(username) on delete cascade,
    movie_imdb_id text not null references public.movies(imdb_id) on delete cascade,
    watched_on date not null,
    rating numeric(2,1),
    review_id uuid,
    tags text[],
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint watch_diary_rating_range check (rating is null or (rating >= 0 and rating <= 10))
);

create index if not exists watch_diary_username_idx on public.watch_diary (username, watched_on desc);
create index if not exists watch_diary_movie_idx on public.watch_diary (movie_imdb_id);

-- ---------------------------------------------------------------------------
-- REVIEWS
-- ---------------------------------------------------------------------------
create table if not exists public.movie_reviews (
    id uuid primary key default gen_random_uuid(),
    username text not null references public.auth_users(username) on delete cascade,
    movie_imdb_id text not null references public.movies(imdb_id) on delete cascade,
    headline text,
    body text,
    rating numeric(2,1),
    is_spoiler boolean not null default false,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint movie_reviews_rating_range check (rating is null or (rating >= 0 and rating <= 10))
);

create unique index if not exists movie_reviews_user_movie_key on public.movie_reviews (username, movie_imdb_id);

-- Ensure the optional review back-reference exists without raising if already present.
do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'watch_diary_review_fk'
          and conrelid = 'public.watch_diary'::regclass
    ) then
        alter table public.watch_diary
            add constraint watch_diary_review_fk foreign key (review_id)
            references public.movie_reviews(id) on delete set null;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- REVIEW LIKES & COMMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.review_likes (
    review_id uuid not null references public.movie_reviews(id) on delete cascade,
    username text not null references public.auth_users(username) on delete cascade,
    created_at timestamptz not null default timezone('utc', now()),
    constraint review_likes_pkey primary key (review_id, username)
);

create table if not exists public.review_comments (
    id uuid primary key default gen_random_uuid(),
    review_id uuid not null references public.movie_reviews(id) on delete cascade,
    username text not null references public.auth_users(username) on delete cascade,
    body text not null,
    parent_comment_id uuid references public.review_comments(id) on delete cascade,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists review_comments_review_idx
    on public.review_comments (review_id, created_at);

create index if not exists review_comments_parent_idx
    on public.review_comments (parent_comment_id);

-- ---------------------------------------------------------------------------
-- LISTS & LIST ITEMS
-- ---------------------------------------------------------------------------
create table if not exists public.user_lists (
    id uuid primary key default gen_random_uuid(),
    username text not null references public.auth_users(username) on delete cascade,
    name text not null,
    description text,
    is_public boolean not null default true,
    sort_order text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint user_lists_unique_name_per_user unique (username, name)
);

create table if not exists public.user_list_items (
    list_id uuid not null references public.user_lists(id) on delete cascade,
    movie_imdb_id text not null references public.movies(imdb_id) on delete cascade,
    notes text,
    position integer,
    added_at timestamptz not null default timezone('utc', now()),
    constraint user_list_items_pkey primary key (list_id, movie_imdb_id)
);

create index if not exists user_list_items_movie_idx on public.user_list_items (movie_imdb_id);

-- ---------------------------------------------------------------------------
-- FAVORITES & TAGS
-- ---------------------------------------------------------------------------
create table if not exists public.user_favorites (
    username text not null references public.auth_users(username) on delete cascade,
    movie_imdb_id text not null references public.movies(imdb_id) on delete cascade,
    created_at timestamptz not null default timezone('utc', now()),
    position integer,
    constraint user_favorites_pkey primary key (username, movie_imdb_id)
);

create index if not exists user_favorites_movie_idx
    on public.user_favorites (movie_imdb_id);

create table if not exists public.user_tags (
    id uuid primary key default gen_random_uuid(),
    username text not null references public.auth_users(username) on delete cascade,
    label text not null,
    constraint user_tags_unique_per_user unique (username, label)
);

-- ---------------------------------------------------------------------------
-- ACTIVITY FEED
-- ---------------------------------------------------------------------------
create table if not exists public.user_activity (
    id uuid primary key default gen_random_uuid(),
    username text not null references public.auth_users(username) on delete cascade,
    verb text not null,
    object_type text not null,
    object_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_activity_username_idx
    on public.user_activity (username, created_at desc);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------
create table if not exists public.user_notifications (
    id uuid primary key default gen_random_uuid(),
    recipient_username text not null references public.auth_users(username) on delete cascade,
    type text not null,
    payload jsonb not null default '{}'::jsonb,
    is_read boolean not null default false,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_notifications_recipient_idx
    on public.user_notifications (recipient_username, is_read, created_at desc);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

-- Enable Row Level Security (RLS) on tables that contain user-specific data so access
-- can be controlled through policies.
alter table public.user_follows        enable row level security;
alter table public.movies              enable row level security;
alter table public.watch_diary         enable row level security;
alter table public.movie_reviews       enable row level security;
alter table public.review_likes        enable row level security;
alter table public.review_comments     enable row level security;
alter table public.user_lists          enable row level security;
alter table public.user_list_items     enable row level security;
alter table public.user_favorites      enable row level security;
alter table public.user_tags           enable row level security;
alter table public.user_activity       enable row level security;
alter table public.user_notifications  enable row level security;

-- Policies are created idempotently; if they already exist the duplicate_object
-- exception is swallowed so the script stays re-runnable.
do $$
declare
    _tbl text;
    _policy text;
begin
    -- Allow the service role full access to every user-specific table. The service role
    -- key is used by the backend API to act on behalf of users.
    FOREACH _tbl IN ARRAY ARRAY[
        'user_follows',
        'watch_diary',
        'movie_reviews',
        'review_likes',
        'review_comments',
        'user_lists',
        'user_list_items',
        'user_favorites',
        'user_tags',
        'user_activity',
        'user_notifications'
    ] LOOP
        _policy := format('service_role_manage_%s', _tbl);
        BEGIN
            EXECUTE format(
                'create policy "%s" on public.%I for all
                 using (auth.role() = ''service_role'')
                 with check (auth.role() = ''service_role'');',
                _policy,
                _tbl
            );
        EXCEPTION
            WHEN duplicate_object THEN
                NULL;
        END;
    END LOOP;

    -- Movies metadata should be readable by any role while still allowing the service
    -- role to manage the cache.
    BEGIN
        create policy "movies_allow_read" on public.movies
            for select using (true);
    EXCEPTION
        WHEN duplicate_object THEN
            NULL;
    END;

    BEGIN
        create policy "movies_service_role_manage" on public.movies
            for all
            using (auth.role() = 'service_role')
            with check (auth.role() = 'service_role');
    EXCEPTION
        WHEN duplicate_object THEN
            NULL;
    END;
end;
$$;

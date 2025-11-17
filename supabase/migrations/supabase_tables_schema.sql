create table IF NOT EXISTS public.auth_sessions (
  token text not null,
  username text not null,
  created_at timestamp with time zone not null,
  last_active_at timestamp with time zone not null,
  last_preferences_sync timestamp with time zone null,
  last_watched_sync timestamp with time zone null,
  last_favorites_sync timestamp with time zone null,
  constraint auth_sessions_pkey primary key (token),
  constraint auth_sessions_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;
create table IF NOT EXISTS public.auth_users (
  username text not null,
  display_name text not null,
  password_hash text not null,
  salt text not null,
  created_at timestamp with time zone not null,
  last_login_at timestamp with time zone null,
  last_preferences_sync timestamp with time zone null,
  last_watched_sync timestamp with time zone null,
  last_favorites_sync timestamp with time zone null,
  preferences_snapshot jsonb null,
  watched_history jsonb null default '[]'::jsonb,
  favorites_list jsonb null default '[]'::jsonb,
  avatar_path text null,
  avatar_url text null,
  constraint auth_users_pkey primary key (username)
) TABLESPACE pg_default;
create table IF NOT EXISTS public.movie_reviews (
  id uuid not null default gen_random_uuid (),
  username text not null,
  movie_imdb_id text not null,
  headline text null,
  body text null,
  rating numeric(2, 1) null,
  is_spoiler boolean not null default false,
  visibility text not null default 'public'::text,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint movie_reviews_pkey primary key (id),
  constraint movie_reviews_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE,
  constraint movie_reviews_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE,
  constraint movie_reviews_rating_range check (
    (
      (rating is null)
      or (
        (rating >= (0)::numeric)
        and (rating <= (10)::numeric)
      )
    )
  ),
  constraint movie_reviews_visibility_check check (
    (
      visibility = any (
        array[
          'public'::text,
          'friends'::text,
          'private'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create unique INDEX IF not exists movie_reviews_user_movie_key on public.movie_reviews using btree (username, movie_imdb_id) TABLESPACE pg_default;
create table IF NOT EXISTS public.movies (
  imdb_id text not null,
  tmdb_id text null,
  title text not null,
  poster_url text null,
  release_year smallint null,
  runtime_minutes integer null,
  genres text[] null,
  synopsis text null,
  last_synced_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint movies_pkey primary key (imdb_id),
  constraint movies_release_year_range check (
    (
      (release_year is null)
      or (release_year >= 1888)
    )
  ),
  constraint movies_runtime_positive check (
    (
      (runtime_minutes is null)
      or (runtime_minutes > 0)
    )
  )
) TABLESPACE pg_default;
create table IF NOT EXISTS public.review_comments (
  id uuid not null default gen_random_uuid (),
  review_id uuid not null,
  username text not null,
  body text not null,
  parent_comment_id uuid null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint review_comments_pkey primary key (id),
  constraint review_comments_parent_comment_id_fkey foreign KEY (parent_comment_id) references review_comments (id) on delete CASCADE,
  constraint review_comments_review_id_fkey foreign KEY (review_id) references movie_reviews (id) on delete CASCADE,
  constraint review_comments_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists review_comments_review_idx on public.review_comments using btree (review_id, created_at) TABLESPACE pg_default;

create index IF not exists review_comments_parent_idx on public.review_comments using btree (parent_comment_id) TABLESPACE pg_default;
create table IF NOT EXISTS public.review_likes (
  review_id uuid not null,
  username text not null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint review_likes_pkey primary key (review_id, username),
  constraint review_likes_review_id_fkey foreign KEY (review_id) references movie_reviews (id) on delete CASCADE,
  constraint review_likes_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;
create table IF NOT EXISTS public.user_activity (
  id uuid not null default gen_random_uuid (),
  username text not null,
  verb text not null,
  object_type text not null,
  object_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint user_activity_pkey primary key (id),
  constraint user_activity_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists user_activity_username_idx on public.user_activity using btree (username, created_at desc) TABLESPACE pg_default;
create table IF NOT EXISTS public.user_favorites (
  username text not null,
  movie_imdb_id text not null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  position integer null,
  constraint user_favorites_pkey primary key (username, movie_imdb_id),
  constraint user_favorites_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE,
  constraint user_favorites_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists user_favorites_movie_idx on public.user_favorites using btree (movie_imdb_id) TABLESPACE pg_default;
create table IF NOT EXISTS public.user_follows (
  follower_username text not null,
  followed_username text not null,
  status text not null default 'accepted'::text,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint user_follows_pkey primary key (follower_username, followed_username),
  constraint user_follows_followed_username_fkey foreign KEY (followed_username) references auth_users (username) on delete CASCADE,
  constraint user_follows_follower_username_fkey foreign KEY (follower_username) references auth_users (username) on delete CASCADE,
  constraint user_follows_no_self_follow check ((follower_username <> followed_username)),
  constraint user_follows_status_check check (
    (
      status = any (
        array[
          'accepted'::text,
          'pending'::text,
          'blocked'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists user_follows_followed_idx on public.user_follows using btree (followed_username) TABLESPACE pg_default;

create index IF not exists user_follows_follower_idx on public.user_follows using btree (follower_username) TABLESPACE pg_default;
create table IF NOT EXISTS public.user_list_items (
  list_id uuid not null,
  movie_imdb_id text not null,
  notes text null,
  position integer null,
  added_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint user_list_items_pkey primary key (list_id, movie_imdb_id),
  constraint user_list_items_list_id_fkey foreign KEY (list_id) references user_lists (id) on delete CASCADE,
  constraint user_list_items_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists user_list_items_movie_idx on public.user_list_items using btree (movie_imdb_id) TABLESPACE pg_default;
create table IF NOT EXISTS public.user_lists (
  id uuid not null default gen_random_uuid (),
  username text not null,
  name text not null,
  description text null,
  is_public boolean not null default true,
  sort_order text null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint user_lists_pkey primary key (id),
  constraint user_lists_unique_name_per_user unique (username, name),
  constraint user_lists_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;
create table IF NOT EXISTS public.user_notifications (
  id uuid not null default gen_random_uuid (),
  recipient_username text not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint user_notifications_pkey primary key (id),
  constraint user_notifications_recipient_username_fkey foreign KEY (recipient_username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists user_notifications_recipient_idx on public.user_notifications using btree (recipient_username, is_read, created_at desc) TABLESPACE pg_default;
create table IF NOT EXISTS public.user_tags (
  id uuid not null default gen_random_uuid (),
  username text not null,
  label text not null,
  constraint user_tags_pkey primary key (id),
  constraint user_tags_unique_per_user unique (username, label),
  constraint user_tags_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;
create table IF NOT EXISTS public.watch_diary (
  id uuid not null default gen_random_uuid (),
  username text not null,
  movie_imdb_id text not null,
  watched_on date not null,
  rating numeric(2, 1) null,
  review_id uuid null,
  tags text[] null,
  visibility text not null default 'public'::text,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint watch_diary_pkey primary key (id),
  constraint watch_diary_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE,
  constraint watch_diary_review_fk foreign KEY (review_id) references movie_reviews (id) on delete set null,
  constraint watch_diary_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE,
  constraint watch_diary_rating_range check (
    (
      (rating is null)
      or (
        (rating >= (0)::numeric)
        and (rating <= (10)::numeric)
      )
    )
  ),
  constraint watch_diary_visibility_check check (
    (
      visibility = any (
        array[
          'public'::text,
          'friends'::text,
          'private'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists watch_diary_username_idx on public.watch_diary using btree (username, watched_on desc) TABLESPACE pg_default;

create index IF not exists watch_diary_movie_idx on public.watch_diary using btree (movie_imdb_id) TABLESPACE pg_default;

-- Ensure all columns exist (safe if already there)

ALTER TABLE IF EXISTS public.auth_sessions
  ADD COLUMN IF NOT EXISTS token text not null,
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null,
  ADD COLUMN IF NOT EXISTS last_active_at timestamp with time zone not null,
  ADD COLUMN IF NOT EXISTS last_preferences_sync timestamp with time zone null,
  ADD COLUMN IF NOT EXISTS last_watched_sync timestamp with time zone null,
  ADD COLUMN IF NOT EXISTS last_favorites_sync timestamp with time zone null;

ALTER TABLE IF EXISTS public.auth_users
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS display_name text not null,
  ADD COLUMN IF NOT EXISTS password_hash text not null,
  ADD COLUMN IF NOT EXISTS salt text not null,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null,
  ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone null,
  ADD COLUMN IF NOT EXISTS last_preferences_sync timestamp with time zone null,
  ADD COLUMN IF NOT EXISTS last_watched_sync timestamp with time zone null,
  ADD COLUMN IF NOT EXISTS last_favorites_sync timestamp with time zone null,
  ADD COLUMN IF NOT EXISTS preferences_snapshot jsonb null,
  ADD COLUMN IF NOT EXISTS watched_history jsonb null default '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS favorites_list jsonb null default '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS avatar_path text null,
  ADD COLUMN IF NOT EXISTS avatar_url text null;

ALTER TABLE IF EXISTS public.movie_reviews
  ADD COLUMN IF NOT EXISTS id uuid not null default gen_random_uuid (),
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS movie_imdb_id text not null,
  ADD COLUMN IF NOT EXISTS headline text null,
  ADD COLUMN IF NOT EXISTS body text null,
  ADD COLUMN IF NOT EXISTS rating numeric(2, 1) null,
  ADD COLUMN IF NOT EXISTS is_spoiler boolean not null default false,
  ADD COLUMN IF NOT EXISTS visibility text not null default 'public'::text,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.movies
  ADD COLUMN IF NOT EXISTS imdb_id text not null,
  ADD COLUMN IF NOT EXISTS tmdb_id text null,
  ADD COLUMN IF NOT EXISTS title text not null,
  ADD COLUMN IF NOT EXISTS poster_url text null,
  ADD COLUMN IF NOT EXISTS release_year smallint null,
  ADD COLUMN IF NOT EXISTS runtime_minutes integer null,
  ADD COLUMN IF NOT EXISTS genres text[] null,
  ADD COLUMN IF NOT EXISTS synopsis text null,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.review_comments
  ADD COLUMN IF NOT EXISTS id uuid not null default gen_random_uuid (),
  ADD COLUMN IF NOT EXISTS review_id uuid not null,
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS body text not null,
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid null,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.review_likes
  ADD COLUMN IF NOT EXISTS review_id uuid not null,
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.user_activity
  ADD COLUMN IF NOT EXISTS id uuid not null default gen_random_uuid (),
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS verb text not null,
  ADD COLUMN IF NOT EXISTS object_type text not null,
  ADD COLUMN IF NOT EXISTS object_id uuid null,
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.user_favorites
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS movie_imdb_id text not null,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS position integer null;

ALTER TABLE IF EXISTS public.user_follows
  ADD COLUMN IF NOT EXISTS follower_username text not null,
  ADD COLUMN IF NOT EXISTS followed_username text not null,
  ADD COLUMN IF NOT EXISTS status text not null default 'accepted'::text,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.user_list_items
  ADD COLUMN IF NOT EXISTS list_id uuid not null,
  ADD COLUMN IF NOT EXISTS movie_imdb_id text not null,
  ADD COLUMN IF NOT EXISTS notes text null,
  ADD COLUMN IF NOT EXISTS position integer null,
  ADD COLUMN IF NOT EXISTS added_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.user_lists
  ADD COLUMN IF NOT EXISTS id uuid not null default gen_random_uuid (),
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS name text not null,
  ADD COLUMN IF NOT EXISTS description text null,
  ADD COLUMN IF NOT EXISTS is_public boolean not null default true,
  ADD COLUMN IF NOT EXISTS sort_order text null,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.user_notifications
  ADD COLUMN IF NOT EXISTS id uuid not null default gen_random_uuid (),
  ADD COLUMN IF NOT EXISTS recipient_username text not null,
  ADD COLUMN IF NOT EXISTS type text not null,
  ADD COLUMN IF NOT EXISTS payload jsonb not null default '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_read boolean not null default false,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now());

ALTER TABLE IF EXISTS public.user_tags
  ADD COLUMN IF NOT EXISTS id uuid not null default gen_random_uuid (),
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS label text not null;

ALTER TABLE IF EXISTS public.watch_diary
  ADD COLUMN IF NOT EXISTS id uuid not null default gen_random_uuid (),
  ADD COLUMN IF NOT EXISTS username text not null,
  ADD COLUMN IF NOT EXISTS movie_imdb_id text not null,
  ADD COLUMN IF NOT EXISTS watched_on date not null,
  ADD COLUMN IF NOT EXISTS rating numeric(2, 1) null,
  ADD COLUMN IF NOT EXISTS review_id uuid null,
  ADD COLUMN IF NOT EXISTS tags text[] null,
  ADD COLUMN IF NOT EXISTS visibility text not null default 'public'::text,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone not null default timezone ('utc'::text, now());

-- Ensure all constraints exist (safe if already there)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_sessions_pkey'
      AND conrelid = 'public.auth_sessions'::regclass
  ) THEN
    ALTER TABLE public.auth_sessions
      ADD CONSTRAINT auth_sessions_pkey primary key (token);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_sessions_username_fkey'
      AND conrelid = 'public.auth_sessions'::regclass
  ) THEN
    ALTER TABLE public.auth_sessions
      ADD CONSTRAINT auth_sessions_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_users_pkey'
      AND conrelid = 'public.auth_users'::regclass
  ) THEN
    ALTER TABLE public.auth_users
      ADD CONSTRAINT auth_users_pkey primary key (username);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movie_reviews_pkey'
      AND conrelid = 'public.movie_reviews'::regclass
  ) THEN
    ALTER TABLE public.movie_reviews
      ADD CONSTRAINT movie_reviews_pkey primary key (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movie_reviews_movie_imdb_id_fkey'
      AND conrelid = 'public.movie_reviews'::regclass
  ) THEN
    ALTER TABLE public.movie_reviews
      ADD CONSTRAINT movie_reviews_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movie_reviews_username_fkey'
      AND conrelid = 'public.movie_reviews'::regclass
  ) THEN
    ALTER TABLE public.movie_reviews
      ADD CONSTRAINT movie_reviews_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movie_reviews_rating_range'
      AND conrelid = 'public.movie_reviews'::regclass
  ) THEN
    ALTER TABLE public.movie_reviews
      ADD CONSTRAINT movie_reviews_rating_range check (
          (
            (rating is null)
            or (
              (rating >= (0)::numeric)
              and (rating <= (10)::numeric)
            )
          )
        );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movie_reviews_visibility_check'
      AND conrelid = 'public.movie_reviews'::regclass
  ) THEN
    ALTER TABLE public.movie_reviews
      ADD CONSTRAINT movie_reviews_visibility_check check (
          (
            visibility = any (
              array[
                'public'::text,
                'friends'::text,
                'private'::text
              ]
            )
          )
        );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movies_pkey'
      AND conrelid = 'public.movies'::regclass
  ) THEN
    ALTER TABLE public.movies
      ADD CONSTRAINT movies_pkey primary key (imdb_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movies_release_year_range'
      AND conrelid = 'public.movies'::regclass
  ) THEN
    ALTER TABLE public.movies
      ADD CONSTRAINT movies_release_year_range check (
          (
            (release_year is null)
            or (release_year >= 1888)
          )
        );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'movies_runtime_positive'
      AND conrelid = 'public.movies'::regclass
  ) THEN
    ALTER TABLE public.movies
      ADD CONSTRAINT movies_runtime_positive check (
          (
            (runtime_minutes is null)
            or (runtime_minutes > 0)
          )
        );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_comments_pkey'
      AND conrelid = 'public.review_comments'::regclass
  ) THEN
    ALTER TABLE public.review_comments
      ADD CONSTRAINT review_comments_pkey primary key (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_comments_parent_comment_id_fkey'
      AND conrelid = 'public.review_comments'::regclass
  ) THEN
    ALTER TABLE public.review_comments
      ADD CONSTRAINT review_comments_parent_comment_id_fkey foreign KEY (parent_comment_id) references review_comments (id) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_comments_review_id_fkey'
      AND conrelid = 'public.review_comments'::regclass
  ) THEN
    ALTER TABLE public.review_comments
      ADD CONSTRAINT review_comments_review_id_fkey foreign KEY (review_id) references movie_reviews (id) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_comments_username_fkey'
      AND conrelid = 'public.review_comments'::regclass
  ) THEN
    ALTER TABLE public.review_comments
      ADD CONSTRAINT review_comments_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_likes_pkey'
      AND conrelid = 'public.review_likes'::regclass
  ) THEN
    ALTER TABLE public.review_likes
      ADD CONSTRAINT review_likes_pkey primary key (review_id, username);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_likes_review_id_fkey'
      AND conrelid = 'public.review_likes'::regclass
  ) THEN
    ALTER TABLE public.review_likes
      ADD CONSTRAINT review_likes_review_id_fkey foreign KEY (review_id) references movie_reviews (id) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_likes_username_fkey'
      AND conrelid = 'public.review_likes'::regclass
  ) THEN
    ALTER TABLE public.review_likes
      ADD CONSTRAINT review_likes_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_activity_pkey'
      AND conrelid = 'public.user_activity'::regclass
  ) THEN
    ALTER TABLE public.user_activity
      ADD CONSTRAINT user_activity_pkey primary key (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_activity_username_fkey'
      AND conrelid = 'public.user_activity'::regclass
  ) THEN
    ALTER TABLE public.user_activity
      ADD CONSTRAINT user_activity_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_favorites_pkey'
      AND conrelid = 'public.user_favorites'::regclass
  ) THEN
    ALTER TABLE public.user_favorites
      ADD CONSTRAINT user_favorites_pkey primary key (username, movie_imdb_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_favorites_movie_imdb_id_fkey'
      AND conrelid = 'public.user_favorites'::regclass
  ) THEN
    ALTER TABLE public.user_favorites
      ADD CONSTRAINT user_favorites_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_favorites_username_fkey'
      AND conrelid = 'public.user_favorites'::regclass
  ) THEN
    ALTER TABLE public.user_favorites
      ADD CONSTRAINT user_favorites_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_follows_pkey'
      AND conrelid = 'public.user_follows'::regclass
  ) THEN
    ALTER TABLE public.user_follows
      ADD CONSTRAINT user_follows_pkey primary key (follower_username, followed_username);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_follows_followed_username_fkey'
      AND conrelid = 'public.user_follows'::regclass
  ) THEN
    ALTER TABLE public.user_follows
      ADD CONSTRAINT user_follows_followed_username_fkey foreign KEY (followed_username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_follows_follower_username_fkey'
      AND conrelid = 'public.user_follows'::regclass
  ) THEN
    ALTER TABLE public.user_follows
      ADD CONSTRAINT user_follows_follower_username_fkey foreign KEY (follower_username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_follows_no_self_follow'
      AND conrelid = 'public.user_follows'::regclass
  ) THEN
    ALTER TABLE public.user_follows
      ADD CONSTRAINT user_follows_no_self_follow check ((follower_username <> followed_username));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_follows_status_check'
      AND conrelid = 'public.user_follows'::regclass
  ) THEN
    ALTER TABLE public.user_follows
      ADD CONSTRAINT user_follows_status_check check (
          (
            status = any (
              array[
                'accepted'::text,
                'pending'::text,
                'blocked'::text
              ]
            )
          )
        );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_list_items_pkey'
      AND conrelid = 'public.user_list_items'::regclass
  ) THEN
    ALTER TABLE public.user_list_items
      ADD CONSTRAINT user_list_items_pkey primary key (list_id, movie_imdb_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_list_items_list_id_fkey'
      AND conrelid = 'public.user_list_items'::regclass
  ) THEN
    ALTER TABLE public.user_list_items
      ADD CONSTRAINT user_list_items_list_id_fkey foreign KEY (list_id) references user_lists (id) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_list_items_movie_imdb_id_fkey'
      AND conrelid = 'public.user_list_items'::regclass
  ) THEN
    ALTER TABLE public.user_list_items
      ADD CONSTRAINT user_list_items_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_lists_pkey'
      AND conrelid = 'public.user_lists'::regclass
  ) THEN
    ALTER TABLE public.user_lists
      ADD CONSTRAINT user_lists_pkey primary key (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_lists_unique_name_per_user'
      AND conrelid = 'public.user_lists'::regclass
  ) THEN
    ALTER TABLE public.user_lists
      ADD CONSTRAINT user_lists_unique_name_per_user unique (username, name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_lists_username_fkey'
      AND conrelid = 'public.user_lists'::regclass
  ) THEN
    ALTER TABLE public.user_lists
      ADD CONSTRAINT user_lists_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_notifications_pkey'
      AND conrelid = 'public.user_notifications'::regclass
  ) THEN
    ALTER TABLE public.user_notifications
      ADD CONSTRAINT user_notifications_pkey primary key (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_notifications_recipient_username_fkey'
      AND conrelid = 'public.user_notifications'::regclass
  ) THEN
    ALTER TABLE public.user_notifications
      ADD CONSTRAINT user_notifications_recipient_username_fkey foreign KEY (recipient_username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_tags_pkey'
      AND conrelid = 'public.user_tags'::regclass
  ) THEN
    ALTER TABLE public.user_tags
      ADD CONSTRAINT user_tags_pkey primary key (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_tags_unique_per_user'
      AND conrelid = 'public.user_tags'::regclass
  ) THEN
    ALTER TABLE public.user_tags
      ADD CONSTRAINT user_tags_unique_per_user unique (username, label);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_tags_username_fkey'
      AND conrelid = 'public.user_tags'::regclass
  ) THEN
    ALTER TABLE public.user_tags
      ADD CONSTRAINT user_tags_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_diary_pkey'
      AND conrelid = 'public.watch_diary'::regclass
  ) THEN
    ALTER TABLE public.watch_diary
      ADD CONSTRAINT watch_diary_pkey primary key (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_diary_movie_imdb_id_fkey'
      AND conrelid = 'public.watch_diary'::regclass
  ) THEN
    ALTER TABLE public.watch_diary
      ADD CONSTRAINT watch_diary_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_diary_review_fk'
      AND conrelid = 'public.watch_diary'::regclass
  ) THEN
    ALTER TABLE public.watch_diary
      ADD CONSTRAINT watch_diary_review_fk foreign KEY (review_id) references movie_reviews (id) on delete set null;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_diary_username_fkey'
      AND conrelid = 'public.watch_diary'::regclass
  ) THEN
    ALTER TABLE public.watch_diary
      ADD CONSTRAINT watch_diary_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_diary_rating_range'
      AND conrelid = 'public.watch_diary'::regclass
  ) THEN
    ALTER TABLE public.watch_diary
      ADD CONSTRAINT watch_diary_rating_range check (
          (
            (rating is null)
            or (
              (rating >= (0)::numeric)
              and (rating <= (10)::numeric)
            )
          )
        );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'watch_diary_visibility_check'
      AND conrelid = 'public.watch_diary'::regclass
  ) THEN
    ALTER TABLE public.watch_diary
      ADD CONSTRAINT watch_diary_visibility_check check (
          (
            visibility = any (
              array[
                'public'::text,
                'friends'::text,
                'private'::text
              ]
            )
          )
        );
  END IF;
END $$;

-- =====================================================================
-- FUTURE-PROOF CORE EXTENSIONS
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Extended user profiles (separate from auth credentials)
-- ---------------------------------------------------------------------
create table IF NOT EXISTS public.user_profiles (
  username text not null,
  bio text null,
  location text null,
  website_url text null,
  favorite_genres text[] null,
  favorite_decades smallint[] null,
  headline text null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint user_profiles_pkey primary key (username),
  constraint user_profiles_username_fkey foreign key (username) references auth_users (username) on delete cascade
) TABLESPACE pg_default;

create index IF not exists user_profiles_location_idx
  on public.user_profiles using btree (location);

-- ---------------------------------------------------------------------
-- 2) Streaming providers & user streaming profiles
-- ---------------------------------------------------------------------
create table IF NOT EXISTS public.streaming_providers (
  key text not null,
  display_name text not null,
  url text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint streaming_providers_pkey primary key (key)
) TABLESPACE pg_default;

create table IF NOT EXISTS public.user_streaming_profiles (
  id uuid not null default gen_random_uuid(),
  username text not null,
  provider_key text not null,
  region text null,
  profile_name text null,
  external_profile_id text null,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint user_streaming_profiles_pkey primary key (id),
  constraint user_streaming_profiles_username_fkey foreign key (username) references auth_users (username) on delete cascade,
  constraint user_streaming_profiles_provider_fkey foreign key (provider_key) references streaming_providers (key) on delete cascade
) TABLESPACE pg_default;

create index IF not exists user_streaming_profiles_user_idx
  on public.user_streaming_profiles using btree (username, provider_key);

-- ---------------------------------------------------------------------
-- 3) Watch parties (for live/shared viewing & chat)
-- ---------------------------------------------------------------------
create table IF NOT EXISTS public.watch_parties (
  id uuid not null default gen_random_uuid(),
  host_username text not null,
  movie_imdb_id text null,
  title text not null,
  description text null,
  status text not null default 'scheduled',
  visibility text not null default 'friends',
  scheduled_for timestamp with time zone null,
  started_at timestamp with time zone null,
  ended_at timestamp with time zone null,
  settings jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint watch_parties_pkey primary key (id),
  constraint watch_parties_host_fkey foreign key (host_username) references auth_users (username) on delete cascade,
  constraint watch_parties_movie_fkey foreign key (movie_imdb_id) references movies (imdb_id) on delete set null
) TABLESPACE pg_default;

create index IF not exists watch_parties_host_idx
  on public.watch_parties using btree (host_username, status, scheduled_for);

create index IF not exists watch_parties_movie_idx
  on public.watch_parties using btree (movie_imdb_id, status);

create table IF NOT EXISTS public.watch_party_participants (
  party_id uuid not null,
  username text not null,
  role text not null default 'guest',
  joined_at timestamp with time zone not null default timezone('utc'::text, now()),
  last_active_at timestamp with time zone null,
  is_kicked boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  constraint watch_party_participants_pkey primary key (party_id, username),
  constraint watch_party_participants_party_fkey foreign key (party_id) references watch_parties (id) on delete cascade,
  constraint watch_party_participants_user_fkey foreign key (username) references auth_users (username) on delete cascade
) TABLESPACE pg_default;

create index IF not exists watch_party_participants_user_idx
  on public.watch_party_participants using btree (username);

create table IF NOT EXISTS public.watch_party_messages (
  id uuid not null default gen_random_uuid(),
  party_id uuid not null,
  username text not null,
  body text not null,
  message_type text not null default 'chat',
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  metadata jsonb not null default '{}'::jsonb,
  constraint watch_party_messages_pkey primary key (id),
  constraint watch_party_messages_party_fkey foreign key (party_id) references watch_parties (id) on delete cascade,
  constraint watch_party_messages_user_fkey foreign key (username) references auth_users (username) on delete cascade
) TABLESPACE pg_default;

create index IF not exists watch_party_messages_party_idx
  on public.watch_party_messages using btree (party_id, created_at);

-- ---------------------------------------------------------------------
-- 4) Conversations & direct messaging (generic chat model)
-- ---------------------------------------------------------------------
create table IF NOT EXISTS public.user_conversations (
  id uuid not null default gen_random_uuid(),
  is_group boolean not null default false,
  created_by_username text not null,
  title text null,
  last_message_at timestamp with time zone null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint user_conversations_pkey primary key (id),
  constraint user_conversations_creator_fkey foreign key (created_by_username) references auth_users (username) on delete cascade
) TABLESPACE pg_default;

create index IF not exists user_conversations_last_message_idx
  on public.user_conversations using btree (last_message_at desc);

create table IF NOT EXISTS public.user_conversation_members (
  conversation_id uuid not null,
  username text not null,
  role text not null default 'member',
  joined_at timestamp with time zone not null default timezone('utc'::text, now()),
  last_read_message_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  constraint user_conversation_members_pkey primary key (conversation_id, username),
  constraint user_conversation_members_conversation_fkey foreign key (conversation_id) references user_conversations (id) on delete cascade,
  constraint user_conversation_members_user_fkey foreign key (username) references auth_users (username) on delete cascade
) TABLESPACE pg_default;

create index IF not exists user_conversation_members_user_idx
  on public.user_conversation_members using btree (username);

create table IF NOT EXISTS public.user_messages (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  sender_username text not null,
  body text not null,
  message_type text not null default 'text',
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  metadata jsonb not null default '{}'::jsonb,
  constraint user_messages_pkey primary key (id),
  constraint user_messages_conversation_fkey foreign key (conversation_id) references user_conversations (id) on delete cascade,
  constraint user_messages_sender_fkey foreign key (sender_username) references auth_users (username) on delete cascade
) TABLESPACE pg_default;

create index IF not exists user_messages_conversation_idx
  on public.user_messages using btree (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- 5) Global config & experiments (feature flags, AB tests)
-- ---------------------------------------------------------------------
create table IF NOT EXISTS public.app_config (
  key text not null,
  value jsonb not null,
  description text null,
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint app_config_pkey primary key (key)
) TABLESPACE pg_default;

create table IF NOT EXISTS public.experiments (
  key text not null,
  description text null,
  is_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint experiments_pkey primary key (key)
) TABLESPACE pg_default;

create table IF NOT EXISTS public.experiment_assignments (
  experiment_key text not null,
  username text not null,
  variant text not null,
  assigned_at timestamp with time zone not null default timezone('utc'::text, now()),
  metadata jsonb not null default '{}'::jsonb,
  constraint experiment_assignments_pkey primary key (experiment_key, username),
  constraint experiment_assignments_experiment_fkey foreign key (experiment_key) references experiments (key) on delete cascade,
  constraint experiment_assignments_user_fkey foreign key (username) references auth_users (username) on delete cascade
) TABLESPACE pg_default;

-- ---------------------------------------------------------------------
-- 6) Search query logging (for future analytics & tuning)
-- ---------------------------------------------------------------------
create table IF NOT EXISTS public.search_queries (
  id uuid not null default gen_random_uuid(),
  username text null,
  query text not null,
  filters jsonb not null default '{}'::jsonb,
  results_count integer null,
  client_context jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint search_queries_pkey primary key (id),
  constraint search_queries_user_fkey foreign key (username) references auth_users (username) on delete set null
) TABLESPACE pg_default;

create index IF not exists search_queries_user_idx
  on public.search_queries using btree (username, created_at desc);

create index IF not exists search_queries_query_idx
  on public.search_queries using gin (to_tsvector('english'::regconfig, query));

-- ---------------------------------------------------------------------
-- 7) Extensible columns on existing tables
-- ---------------------------------------------------------------------

-- auth_sessions: device & expiry details
ALTER TABLE IF EXISTS public.auth_sessions
  ADD COLUMN IF NOT EXISTS ip_address inet null,
  ADD COLUMN IF NOT EXISTS user_agent text null,
  ADD COLUMN IF NOT EXISTS device_info jsonb null,
  ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone null;

-- auth_users: contact, privacy & settings
ALTER TABLE IF EXISTS public.auth_users
  ADD COLUMN IF NOT EXISTS email text null,
  ADD COLUMN IF NOT EXISTS is_email_verified boolean not null default false,
  ADD COLUMN IF NOT EXISTS bio text null,
  ADD COLUMN IF NOT EXISTS location text null,
  ADD COLUMN IF NOT EXISTS website_url text null,
  ADD COLUMN IF NOT EXISTS time_zone text null,
  ADD COLUMN IF NOT EXISTS locale text null,
  ADD COLUMN IF NOT EXISTS is_private boolean not null default false,
  ADD COLUMN IF NOT EXISTS settings jsonb not null default '{}'::jsonb;

-- movies: extended metadata & aggregates
ALTER TABLE IF EXISTS public.movies
  ADD COLUMN IF NOT EXISTS original_title text null,
  ADD COLUMN IF NOT EXISTS release_date date null,
  ADD COLUMN IF NOT EXISTS original_language text null,
  ADD COLUMN IF NOT EXISTS production_countries text[] null,
  ADD COLUMN IF NOT EXISTS providers jsonb null,
  ADD COLUMN IF NOT EXISTS external_ids jsonb null,
  ADD COLUMN IF NOT EXISTS rating_average numeric(3, 2) null,
  ADD COLUMN IF NOT EXISTS rating_count integer not null default 0,
  ADD COLUMN IF NOT EXISTS popularity_score numeric(10, 4) null,
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- watch_diary: richer logging per viewing
ALTER TABLE IF EXISTS public.watch_diary
  ADD COLUMN IF NOT EXISTS rewatch_number integer not null default 1,
  ADD COLUMN IF NOT EXISTS source text null,
  ADD COLUMN IF NOT EXISTS device text null,
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- movie_reviews: counters, tags & metadata
ALTER TABLE IF EXISTS public.movie_reviews
  ADD COLUMN IF NOT EXISTS likes_count integer not null default 0,
  ADD COLUMN IF NOT EXISTS comments_count integer not null default 0,
  ADD COLUMN IF NOT EXISTS tags text[] null,
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- review_comments: metadata
ALTER TABLE IF EXISTS public.review_comments
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- review_likes: metadata
ALTER TABLE IF EXISTS public.review_likes
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- user_favorites: metadata (e.g. reason, origin)
ALTER TABLE IF EXISTS public.user_favorites
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- user_follows (user_followers in schema): extensible relationship flags
ALTER TABLE IF EXISTS public.user_followers
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- user_lists: type, collaboration, metadata
ALTER TABLE IF EXISTS public.user_lists
  ADD COLUMN IF NOT EXISTS kind text null,
  ADD COLUMN IF NOT EXISTS is_collaborative boolean not null default false,
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- user_list_items: per-item metadata (notes, pinned, source)
ALTER TABLE IF EXISTS public.user_list_items
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

-- user_tags: freeform metadata (color, icon, etc.)
ALTER TABLE IF EXISTS public.user_tags
  ADD COLUMN IF NOT EXISTS metadata jsonb not null default '{}'::jsonb;

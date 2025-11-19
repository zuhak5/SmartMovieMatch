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

create table IF NOT EXISTS public.trending_movies (
  id uuid not null default gen_random_uuid (),
  movie_imdb_id text not null,
  time_window text not null default 'weekly'::text,
  rank integer null,
  trend_score numeric(10, 4) null,
  captured_at timestamp with time zone not null default timezone ('utc'::text, now()),
  context jsonb null,
  constraint trending_movies_pkey primary key (id),
  constraint trending_movies_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE,
  constraint trending_movies_time_window_check check (
    (
      time_window = any (
        array[
          'daily'::text,
          'weekly'::text,
          'monthly'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create unique INDEX IF not exists trending_movies_window_movie_idx on public.trending_movies using btree (time_window, movie_imdb_id) TABLESPACE pg_default;
create index IF not exists trending_movies_rank_idx on public.trending_movies using btree (time_window, rank, trend_score) TABLESPACE pg_default;
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

create table IF NOT EXISTS public.user_tagged_movies (
  id uuid not null default gen_random_uuid(),
  username text not null,
  tag_id uuid not null,
  movie_imdb_id text not null,
  movie_tmdb_id text null,
  movie_title text null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  metadata jsonb not null default '{}'::jsonb,
  constraint user_tagged_movies_pkey primary key (id),
  constraint user_tagged_movies_user_fkey foreign key (username) references auth_users (username) on delete cascade,
  constraint user_tagged_movies_tag_fkey foreign key (tag_id) references user_tags (id) on delete cascade,
  constraint user_tagged_movies_movie_fkey foreign key (movie_imdb_id) references movies (imdb_id) on delete cascade
) TABLESPACE pg_default;

create unique index IF not exists user_tagged_movies_unique_idx
  on public.user_tagged_movies using btree (username, tag_id, movie_imdb_id);

create index IF not exists user_tagged_movies_tag_idx
  on public.user_tagged_movies using btree (tag_id);

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

create table IF NOT EXISTS public.movie_availability (
  id uuid not null default gen_random_uuid(),
  movie_imdb_id text not null,
  provider_key text not null,
  region text null,
  deeplink text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint movie_availability_pkey primary key (id),
  constraint movie_availability_movie_fkey foreign key (movie_imdb_id) references movies (imdb_id) on delete cascade,
  constraint movie_availability_provider_fkey foreign key (provider_key) references streaming_providers (key) on delete cascade
) TABLESPACE pg_default;

create unique index IF not exists movie_availability_movie_provider_region_idx
  on public.movie_availability using btree (movie_imdb_id, provider_key, coalesce(region, ''));

insert into public.streaming_providers as sp (key, display_name, url, metadata)
values
  ('netflix', 'Netflix', 'https://www.netflix.com', '{"brand_color": "#e50914"}'),
  ('prime-video', 'Prime Video', 'https://www.primevideo.com', '{"brand_color": "#00a8e1"}'),
  ('disney-plus', 'Disney+', 'https://www.disneyplus.com', '{"brand_color": "#113ccf"}'),
  ('max', 'Max', 'https://www.max.com', '{"brand_color": "#3300cc"}'),
  ('hulu', 'Hulu', 'https://www.hulu.com', '{"brand_color": "#1ce783"}'),
  ('apple-tv', 'Apple TV+', 'https://tv.apple.com', '{"brand_color": "#0a84ff"}'),
  ('peacock', 'Peacock', 'https://www.peacocktv.com', '{"brand_color": "#000000"}'),
  ('paramount-plus', 'Paramount+', 'https://www.paramountplus.com', '{"brand_color": "#0064d2"}')
on conflict (key) do update
  set display_name = excluded.display_name,
      url = excluded.url,
      metadata = excluded.metadata,
      updated_at = timezone('utc'::text, now());

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

-- =====================================================================
-- FEATURE MAPPING & RLS POLICIES
-- =====================================================================
-- This section documents how the newer tables/columns map to upcoming
-- product features AND defines Supabase Row Level Security (RLS) policies
-- so the public schema can be safely exposed to the client.

-- ---------------------------------------------------------------------
-- FEATURE MAPPING (high level)
-- ---------------------------------------------------------------------
-- user_profiles
--   Powers:
--     - Rich profile pages (bio, location, website) instead of only username.
--     - Onboarding wizard that asks for favorite genres/decades.
--     - Profile-level settings in `settings` (layout, discovery, etc.).
--   Key columns:
--     - favorite_genres, favorite_decades, headline, settings.

-- auth_users (new columns)
--   Powers:
--     - Email-based flows and login alerts (email, is_email_verified).
--     - Privacy toggles for the whole account (is_private).
--     - Localized UI and timestamps (time_zone, locale).
--     - Per-account preferences without schema churn (settings jsonb).

-- streaming_providers
--   Powers:
--     - Registry of supported streaming services (Netflix, Prime, etc.).
--     - Filter/search by provider and show provider badges on movie cards.

-- user_streaming_profiles
--   Powers:
--     - Onboarding step "Where do you watch?".
--     - Filter: "Only show movies on the services I subscribe to".
--     - Future: per-provider sync of watch history.

-- movies (new columns)
--   Powers:
--     - Richer metadata & discovery:
--         * international titles (original_title, original_language),
--         * release_date vs release_year,
--         * production_countries,
--         * providers/external_ids jsonb for deep links,
--         * rating_average + rating_count for sort & badges,
--         * popularity_score for trending views.

-- movie_reviews (new columns)
--   Powers:
--     - Engagement counters on reviews (likes_count, comments_count).
--     - Review tags for filtering and badges (tags).
--     - Extra behavior flags / moderation data (metadata).

-- review_comments, review_likes (metadata)
--   Powers:
--     - Track reactions, edits, moderation, UI state on comments/likes.

-- user_favorites (metadata)
--   Powers:
--     - Per-favorite notes, source of discovery, pinned flags.

-- user_follows (metadata)
--   Powers:
--     - Relationship flags like "close friend", "muted", "request origin".

-- user_lists (kind, is_collaborative, metadata)
--   Powers:
--     - Different list types: watchlist, challenge, ranked list, etc.
--     - Collaborative lists where friends can contribute items.
--     - Additional list settings (sort behavior, cover image) via metadata.

-- user_list_items (metadata)
--   Powers:
--     - Per-entry notes, pinned flag, discovery source.

-- user_tags (metadata)
--   Powers:
--     - Color/icon/emoji styling and behavior flags for tags.

-- watch_parties / watch_party_participants / watch_party_messages
--   Powers:
--     - Scheduled & live watch parties with host, title, description.
--     - Participation list with roles (host/guest), kicks, presence.
--     - In-party chat messages, including future system & reaction messages.

-- user_conversations / user_conversation_members / user_messages
--   Powers:
--     - Direct messages and group chats (movie clubs, friend chats).
--     - Membership roles and read state (last_read_message_id).
--     - Rich message types (text, system, suggestion) via message_type + metadata.

-- app_config
--   Powers:
--     - Remote config for limits, feature toggles, and UI behavior without redeploy.

-- experiments / experiment_assignments
--   Powers:
--     - AB testing of layouts, recommendation algorithms, and onboarding flows.

-- search_queries
--   Powers:
--     - Per-user recent searches.
--     - Global analytics for search UX and auto-suggest models.


-- ---------------------------------------------------------------------
-- HELPER: Resolve current app username from Supabase JWT
-- ---------------------------------------------------------------------
-- Assumes your JWT includes either:
--   - "username" claim, or
--   - uses the "sub" claim as the username.
-- If neither is present, this returns NULL.
create or replace function public.current_username()
returns text
language plpgsql
stable
as $$
declare
  claims jsonb;
begin
  -- auth.jwt() is a Supabase helper which returns the JWT claims as jsonb.
  -- If it's not available for some reason, fall back to NULL.
  begin
    claims := auth.jwt();
  exception
    when others then
      return null;
  end;

  if claims is null then
    return null;
  end if;

  return coalesce(
    nullif(claims->>'username', ''),
    nullif(claims->>'sub', '')
  );
end;
$$;


-- ---------------------------------------------------------------------
-- RLS: Movies & streaming metadata
-- ---------------------------------------------------------------------
alter table public.movies enable row level security;

drop policy if exists "Movies are readable by everyone" on public.movies;

create policy "Movies are readable by everyone"
  on public.movies
  for select
  to anon, authenticated
  using ( true );

alter table public.trending_movies enable row level security;

drop policy if exists "Trending movies are readable by everyone" on public.trending_movies;

create policy "Trending movies are readable by everyone"
  on public.trending_movies
  for select
  to anon, authenticated
  using ( true );

alter table public.streaming_providers enable row level security;

drop policy if exists "Streaming providers are readable by everyone" on public.streaming_providers;
create policy "Streaming providers are readable by everyone"
  on public.streaming_providers
  for select
  to anon, authenticated
  using ( true );

alter table public.movie_availability enable row level security;

drop policy if exists "Movie availability is readable by everyone" on public.movie_availability;
create policy "Movie availability is readable by everyone"
  on public.movie_availability
  for select
  to anon, authenticated
  using ( true );

alter table public.user_streaming_profiles enable row level security;

drop policy if exists "Users can read their streaming profiles" on public.user_streaming_profiles;
create policy "Users can read their streaming profiles"
  on public.user_streaming_profiles
  for select
  to authenticated
  using ( username = current_username() );

drop policy if exists "Users can manage their streaming profiles" on public.user_streaming_profiles;
create policy "Users can manage their streaming profiles"
  on public.user_streaming_profiles
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );


-- ---------------------------------------------------------------------
-- RLS: Extended profiles & account privacy
-- ---------------------------------------------------------------------
alter table public.user_profiles enable row level security;

drop policy if exists "Public or own profiles are readable" on public.user_profiles;
create policy "Public or own profiles are readable"
  on public.user_profiles
  for select
  to anon, authenticated
  using (
    -- Owner can always see their own profile
    (current_username() is not null and username = current_username())
    -- Everyone can see profiles for non-private accounts
    or exists (
      select 1
      from public.auth_users u
      where u.username = user_profiles.username
        and coalesce(u.is_private, false) = false
    )
  );

drop policy if exists "Users can manage their own profile" on public.user_profiles;
create policy "Users can manage their own profile"
  on public.user_profiles
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );


-- ---------------------------------------------------------------------


drop policy if exists "Reviews are visible based on visibility + follows" on public.movie_reviews;
create policy "Reviews are visible based on visibility + follows"
  on public.movie_reviews
  for select
  to anon, authenticated
  using (
    -- Owner
    (current_username() is not null and username = current_username())
    -- Public reviews
    or visibility = 'public'
    -- Friends-only reviews
    or (
      visibility = 'friends'
      and current_username() is not null
      and exists (
        select 1
        from public.user_follows f
        where f.follower_username = current_username()
          and f.followed_username = movie_reviews.username
          and f.status = 'accepted'
      )
    )
  );

drop policy if exists "Users can manage their own reviews" on public.movie_reviews;
create policy "Users can manage their own reviews"
  on public.movie_reviews
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );


alter table public.review_comments enable row level security;

drop policy if exists "Comments visible if you can see the parent review or you wrote them" on public.review_comments;
create policy "Comments visible if you can see the parent review or you wrote them"
  on public.review_comments
  for select
  to anon, authenticated
  using (
    -- Owner of the comment
    (current_username() is not null and username = current_username())
    -- Or you can see the parent review under its own rules
    or exists (
      select 1
      from public.movie_reviews r
      where r.id = review_id
        and (
          -- Same logic as movie_reviews SELECT policy
          (current_username() is not null and r.username = current_username())
          or r.visibility = 'public'
          or (
            r.visibility = 'friends'
            and current_username() is not null
            and exists (
              select 1
              from public.user_follows f
              where f.follower_username = current_username()
                and f.followed_username = r.username
                and f.status = 'accepted'
            )
          )
        )
    )
  );

drop policy if exists "Users can manage their own comments" on public.review_comments;
create policy "Users can manage their own comments"
  on public.review_comments
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );


alter table public.review_likes enable row level security;

drop policy if exists "Users can see which reviews they liked" on public.review_likes;
create policy "Users can see which reviews they liked"
  on public.review_likes
  for select
  to authenticated
  using ( username = current_username() );

drop policy if exists "Users can like/unlike reviews as themselves" on public.review_likes;
create policy "Users can like/unlike reviews as themselves"
  on public.review_likes
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );


-- ---------------------------------------------------------------------
-- RLS: User favorites, follows, tags, lists
-- ---------------------------------------------------------------------
alter table public.user_favorites enable row level security;

drop policy if exists "Favorites visible based on account privacy" on public.user_favorites;
create policy "Favorites visible based on account privacy"
  on public.user_favorites
  for select
  to anon, authenticated
  using (
    -- Owner sees all their favorites
    (current_username() is not null and username = current_username())
    -- Everyone can see favorites of non-private accounts
    or exists (
      select 1
      from public.auth_users u
      where u.username = user_favorites.username
        and coalesce(u.is_private, false) = false
    )
    -- Followers can see favorites of private accounts they follow
    or (
      current_username() is not null
      and exists (
        select 1
        from public.auth_users u
        join public.user_follows f
          on f.followed_username = u.username
         and f.follower_username = current_username()
        where u.username = user_favorites.username
          and coalesce(u.is_private, false) = true
          and f.status = 'accepted'
      )
    )
  );

drop policy if exists "Users can manage their own favorites" on public.user_favorites;
create policy "Users can manage their own favorites"
  on public.user_favorites
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );


alter table public.user_follows enable row level security;

drop policy if exists "Users can see relationships they are part of" on public.user_follows;
create policy "Users can see relationships they are part of"
  on public.user_follows
  for select
  to authenticated
  using (
    follower_username = current_username()
    or followed_username = current_username()
  );

drop policy if exists "Users can follow others" on public.user_follows;
create policy "Users can follow others"
  on public.user_follows
  for insert
  to authenticated
  with check ( follower_username = current_username() );

drop policy if exists "Users can update their follow status" on public.user_follows;
create policy "Users can update their follow status"
  on public.user_follows
  for update
  to authenticated
  using (
    follower_username = current_username()
    or followed_username = current_username()
  )
  with check (
    follower_username = current_username()
    or followed_username = current_username()
  );

drop policy if exists "Users can unfollow others" on public.user_follows;
create policy "Users can unfollow others"
  on public.user_follows
  for delete
  to authenticated
  using ( follower_username = current_username() );


alter table public.user_lists enable row level security;

drop policy if exists "Lists visible if public or owned" on public.user_lists;
create policy "Lists visible if public or owned"
  on public.user_lists
  for select
  to anon, authenticated
  using (
    (current_username() is not null and username = current_username())
    or is_public = true
  );

drop policy if exists "Users can manage their own lists" on public.user_lists;
create policy "Users can manage their own lists"
  on public.user_lists
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );


alter table public.user_list_items enable row level security;

drop policy if exists "List items visible when parent list is visible" on public.user_list_items;
create policy "List items visible when parent list is visible"
  on public.user_list_items
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.user_lists l
      where l.id = list_id
        and (
          (current_username() is not null and l.username = current_username())
          or l.is_public = true
        )
    )
  );

drop policy if exists "Only list owners (or collaborative lists) can manage items" on public.user_list_items;
create policy "Only list owners (or collaborative lists) can manage items"
  on public.user_list_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.user_lists l
      where l.id = list_id
        and (
          l.username = current_username()
          or l.is_collaborative = true
        )
    )
  )
  with check (
    exists (
      select 1
      from public.user_lists l
      where l.id = list_id
        and (
          l.username = current_username()
          or l.is_collaborative = true
        )
    )
  );


alter table public.user_tags enable row level security;

drop policy if exists "Users can see their own tags" on public.user_tags;
create policy "Users can see their own tags"
  on public.user_tags
  for select
  to authenticated
  using ( username = current_username() );

drop policy if exists "Users can manage their own tags" on public.user_tags;
create policy "Users can manage their own tags"
  on public.user_tags
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );

alter table public.user_tagged_movies enable row level security;

drop policy if exists "Users can view their tagged movies" on public.user_tagged_movies;
create policy "Users can view their tagged movies"
  on public.user_tagged_movies
  for select
  to authenticated
  using ( username = current_username() );

drop policy if exists "Users can manage their tagged movies" on public.user_tagged_movies;
create policy "Users can manage their tagged movies"
  on public.user_tagged_movies
  for all
  to authenticated
  using ( username = current_username() )
  with check ( username = current_username() );


-- ---------------------------------------------------------------------
-- RLS: Notifications & activity
-- ---------------------------------------------------------------------
alter table public.user_notifications enable row level security;

drop policy if exists "Users can see their own notifications" on public.user_notifications;
create policy "Users can see their own notifications"
  on public.user_notifications
  for select
  to authenticated
  using ( recipient_username = current_username() );

drop policy if exists "Users can mark their notifications as read" on public.user_notifications;
create policy "Users can mark their notifications as read"
  on public.user_notifications
  for update
  to authenticated
  using ( recipient_username = current_username() )
  with check ( recipient_username = current_username() );


alter table public.user_activity enable row level security;

drop policy if exists "Users can see their own activity log" on public.user_activity;
create policy "Users can see their own activity log"
  on public.user_activity
  for select
  to authenticated
  using ( username = current_username() );

drop policy if exists "Users can append to their own activity log" on public.user_activity;
create policy "Users can append to their own activity log"
  on public.user_activity
  for insert
  to authenticated
  with check ( username = current_username() );


-- ---------------------------------------------------------------------
-- RLS: Watch parties (real-time social)
-- ---------------------------------------------------------------------
alter table public.watch_parties enable row level security;

drop policy if exists "Watch parties visible based on visibility, host, or participation" on public.watch_parties;
create policy "Watch parties visible based on visibility, host, or participation"
  on public.watch_parties
  for select
  to anon, authenticated
  using (
    -- Host always sees their parties
    (current_username() is not null and host_username = current_username())
    -- Public parties visible to everyone
    or status in ('scheduled', 'live') and visibility = 'public'
    -- Friends-only parties: followers of the host can see them
    or (
      status in ('scheduled', 'live')
      and visibility = 'friends'
      and current_username() is not null
      and exists (
        select 1
        from public.user_follows f
        where f.follower_username = current_username()
          and f.followed_username = watch_parties.host_username
          and f.status = 'accepted'
      )
    )
    -- Any participant can see the party
    or (
      current_username() is not null
      and exists (
        select 1
        from public.watch_party_participants p
        where p.party_id = watch_parties.id
          and p.username = current_username()
      )
    )
  );

drop policy if exists "Hosts can manage their own watch parties" on public.watch_parties;
create policy "Hosts can manage their own watch parties"
  on public.watch_parties
  for all
  to authenticated
  using ( host_username = current_username() )
  with check ( host_username = current_username() );


alter table public.watch_party_participants enable row level security;

drop policy if exists "Participants and host can view participants" on public.watch_party_participants;
create policy "Participants and host can view participants"
  on public.watch_party_participants
  for select
  to authenticated
  using (
    username = current_username()
    or exists (
      select 1
      from public.watch_parties wp
      where wp.id = party_id
        and wp.host_username = current_username()
    )
    or exists (
      select 1
      from public.watch_party_participants p2
      where p2.party_id = party_id
        and p2.username = current_username()
    )
  );

drop policy if exists "Hosts can invite participants; users can join themselves" on public.watch_party_participants;
create policy "Hosts can invite participants; users can join themselves"
  on public.watch_party_participants
  for insert
  to authenticated
  with check (
    -- User joins themselves
    username = current_username()
    -- Or host invites someone else
    or exists (
      select 1
      from public.watch_parties wp
      where wp.id = party_id
        and wp.host_username = current_username()
    )
  );

drop policy if exists "Hosts or participants can update participant state" on public.watch_party_participants;
create policy "Hosts or participants can update participant state"
  on public.watch_party_participants
  for all
  to authenticated
  using (
    username = current_username()
    or exists (
      select 1
      from public.watch_parties wp
      where wp.id = party_id
        and wp.host_username = current_username()
    )
  )
  with check (
    username = current_username()
    or exists (
      select 1
      from public.watch_parties wp
      where wp.id = party_id
        and wp.host_username = current_username()
    )
  );


alter table public.watch_party_messages enable row level security;

drop policy if exists "Only participants/host can read party messages" on public.watch_party_messages;
create policy "Only participants/host can read party messages"
  on public.watch_party_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.watch_party_participants p
      where p.party_id = party_id
        and p.username = current_username()
    )
    or exists (
      select 1
      from public.watch_parties wp
      where wp.id = party_id
        and wp.host_username = current_username()
    )
  );

drop policy if exists "Only participants/host can send party messages" on public.watch_party_messages;
create policy "Only participants/host can send party messages"
  on public.watch_party_messages
  for insert
  to authenticated
  with check (
    username = current_username()
    and (
      exists (
        select 1
        from public.watch_party_participants p
        where p.party_id = party_id
          and p.username = current_username()
      )
      or exists (
        select 1
        from public.watch_parties wp
        where wp.id = party_id
          and wp.host_username = current_username()
      )
    )
  );


-- ---------------------------------------------------------------------
-- RLS: Direct messages & conversations
-- ---------------------------------------------------------------------
alter table public.user_conversations enable row level security;

drop policy if exists "Users can see conversations they belong to" on public.user_conversations;
create policy "Users can see conversations they belong to"
  on public.user_conversations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_conversation_members m
      where m.conversation_id = user_conversations.id
        and m.username = current_username()
    )
  );

drop policy if exists "Users can create conversations they own" on public.user_conversations;
create policy "Users can create conversations they own"
  on public.user_conversations
  for insert
  to authenticated
  with check ( created_by_username = current_username() );

drop policy if exists "Only members with elevated role can update/delete conversations" on public.user_conversations;
create policy "Only members with elevated role can update/delete conversations"
  on public.user_conversations
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.user_conversation_members m
      where m.conversation_id = user_conversations.id
        and m.username = current_username()
        and m.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from public.user_conversation_members m
      where m.conversation_id = user_conversations.id
        and m.username = current_username()
        and m.role in ('owner', 'admin')
    )
  );


alter table public.user_conversation_members enable row level security;

drop policy if exists "Members can see membership of conversations they are in" on public.user_conversation_members;
create policy "Members can see membership of conversations they are in"
  on public.user_conversation_members
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_conversation_members self
      where self.conversation_id = conversation_id
        and self.username = current_username()
    )
  );

drop policy if exists "Creators can add members; users can join themselves" on public.user_conversation_members;
create policy "Creators can add members; users can join themselves"
  on public.user_conversation_members
  for insert
  to authenticated
  with check (
    username = current_username()
    or exists (
      select 1
      from public.user_conversations c
      where c.id = conversation_id
        and c.created_by_username = current_username()
    )
  );

drop policy if exists "Members and creators can update/remove members" on public.user_conversation_members;
create policy "Members and creators can update/remove members"
  on public.user_conversation_members
  for all
  to authenticated
  using (
    username = current_username()
    or exists (
      select 1
      from public.user_conversations c
      where c.id = conversation_id
        and c.created_by_username = current_username()
    )
  )
  with check (
    username = current_username()
    or exists (
      select 1
      from public.user_conversations c
      where c.id = conversation_id
        and c.created_by_username = current_username()
    )
  );


alter table public.user_messages enable row level security;

drop policy if exists "Only conversation members can read messages" on public.user_messages;
create policy "Only conversation members can read messages"
  on public.user_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_conversation_members m
      where m.conversation_id = user_messages.conversation_id
        and m.username = current_username()
    )
  );

drop policy if exists "Only conversation members can send messages as themselves" on public.user_messages;
create policy "Only conversation members can send messages as themselves"
  on public.user_messages
  for insert
  to authenticated
  with check (
    sender_username = current_username()
    and exists (
      select 1
      from public.user_conversation_members m
      where m.conversation_id = user_messages.conversation_id
        and m.username = current_username()
    )
  );


-- ---------------------------------------------------------------------
-- RLS: App config, experiments & search analytics
-- ---------------------------------------------------------------------
alter table public.app_config enable row level security;

drop policy if exists "App config is readable by all clients" on public.app_config;
create policy "App config is readable by all clients"
  on public.app_config
  for select
  to anon, authenticated
  using ( true );
-- (No INSERT/UPDATE/DELETE policy: only service_role can modify via bypass RLS)


alter table public.experiments enable row level security;

drop policy if exists "Experiments are readable by all clients" on public.experiments;
create policy "Experiments are readable by all clients"
  on public.experiments
  for select
  to anon, authenticated
  using ( true );


alter table public.experiment_assignments enable row level security;

drop policy if exists "Users can see their own experiment assignments" on public.experiment_assignments;
create policy "Users can see their own experiment assignments"
  on public.experiment_assignments
  for select
  to authenticated
  using ( username = current_username() );
-- Assignments should be written by backend jobs only; no client write policy.


alter table public.search_queries enable row level security;

drop policy if exists "Users can see their own search queries" on public.search_queries;
create policy "Users can see their own search queries"
  on public.search_queries
  for select
  to authenticated
  using ( username = current_username() );

drop policy if exists "Clients can log their own searches (or anonymous ones)" on public.search_queries;
create policy "Clients can log their own searches (or anonymous ones)"
  on public.search_queries
  for insert
  to anon, authenticated
  with check (
    username is null
    or username = current_username()
  );

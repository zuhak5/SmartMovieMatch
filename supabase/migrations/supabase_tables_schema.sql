create table public.auth_sessions (
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
create table public.auth_users (
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
create table public.movie_reviews (
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
create table public.movies (
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
create table public.review_comments (
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
create table public.review_likes (
  review_id uuid not null,
  username text not null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint review_likes_pkey primary key (review_id, username),
  constraint review_likes_review_id_fkey foreign KEY (review_id) references movie_reviews (id) on delete CASCADE,
  constraint review_likes_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;
create table public.user_activity (
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
create table public.user_favorites (
  username text not null,
  movie_imdb_id text not null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  position integer null,
  constraint user_favorites_pkey primary key (username, movie_imdb_id),
  constraint user_favorites_movie_imdb_id_fkey foreign KEY (movie_imdb_id) references movies (imdb_id) on delete CASCADE,
  constraint user_favorites_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists user_favorites_movie_idx on public.user_favorites using btree (movie_imdb_id) TABLESPACE pg_default;
create table public.user_follows (
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
create table public.user_list_items (
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
create table public.user_lists (
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
create table public.user_notifications (
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
create table public.user_tags (
  id uuid not null default gen_random_uuid (),
  username text not null,
  label text not null,
  constraint user_tags_pkey primary key (id),
  constraint user_tags_unique_per_user unique (username, label),
  constraint user_tags_username_fkey foreign KEY (username) references auth_users (username) on delete CASCADE
) TABLESPACE pg_default;
create table public.watch_diary (
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

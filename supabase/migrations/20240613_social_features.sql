create extension if not exists "pgcrypto" with schema public;

create table if not exists public.social_follows (
  follower_username text not null references public.auth_users (username) on delete cascade,
  followee_username text not null references public.auth_users (username) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint social_follows_pkey primary key (follower_username, followee_username),
  constraint social_follows_no_self_follow check (follower_username <> followee_username)
);

create index if not exists social_follows_followee_idx on public.social_follows (followee_username);
create index if not exists social_follows_follower_idx on public.social_follows (follower_username);

create table if not exists public.social_reviews (
  id uuid primary key default gen_random_uuid(),
  author_username text not null references public.auth_users (username) on delete cascade,
  movie_tmdb_id text not null,
  movie_imdb_id text null,
  movie_title text not null,
  rating numeric(3, 1) not null check (rating >= 0 and rating <= 10),
  body text null,
  has_spoilers boolean not null default false,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint social_reviews_unique_per_movie unique (author_username, movie_tmdb_id)
);

create index if not exists social_reviews_movie_idx on public.social_reviews (movie_tmdb_id, updated_at desc);
create index if not exists social_reviews_author_idx on public.social_reviews (author_username, updated_at desc);

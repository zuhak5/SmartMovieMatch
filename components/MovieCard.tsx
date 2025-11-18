import React from "react";

type MovieCardProps = {
  posterUrl: string;
  title: string;
  year: string | number;
  description?: string;
  imdbScore: number;
  rtScore: number;
  Favorite: boolean;
  watched: boolean;
  onToggleFavorite?: () => void;
  onToggleWatched?: () => void;
};

const HeartIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path
      d="M12 21s-6.5-4.35-9-9c-1.9-3.6.6-7.5 4-7.5 2 0 3.2 1.1 5 3 1.8-1.9 3-3 5-3 3.4 0 5.9 3.9 4 7.5-2.5 4.65-9 9-9 9Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CheckIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path
      d="M20 6 9 17l-5-5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const MovieCard: React.FC<MovieCardProps> = ({
  posterUrl,
  title,
  year,
  description,
  imdbScore,
  rtScore,
  Favorite,
  watched,
  onToggleFavorite,
  onToggleWatched,
}) => {
  const isFavorite = Favorite;
  const favoriteLabel = isFavorite ? "Unfavorite movie" : "Favorite movie";
  const watchedLabel = watched ? "Mark as unwatched" : "Mark as watched";

  return (
    <article className="group relative flex min-h-[180px] overflow-hidden rounded-xl border border-white/10 bg-white/10 shadow-lg backdrop-blur-md transition duration-200 ease-out hover:scale-[1.02] hover:shadow-xl">
      <div className="relative basis-2/5 min-w-[120px] max-w-[180px] bg-black/30 sm:max-w-[200px]">
        <img
          src={posterUrl}
          alt={`${title} poster`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>

      <div className="flex flex-1 flex-col justify-between gap-2 p-3 sm:p-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold text-white sm:text-lg">{title}</h3>
              <p className="text-xs text-slate-300 sm:text-sm">{year}</p>
            </div>
          </div>

          {description && (
            <p className="text-sm text-slate-300 line-clamp-2 sm:line-clamp-3">{description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-200 sm:text-sm">
            <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-amber-100 shadow-inner ring-1 ring-white/10">
              <span className="font-semibold">IMDb</span>
              <span>{imdbScore.toFixed(1)}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-emerald-100 shadow-inner ring-1 ring-white/10">
              <span className="font-semibold">RT</span>
              <span>{rtScore}%</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-label={favoriteLabel}
              className={`inline-flex items-center gap-1 rounded-full border border-white/10 p-1.5 text-slate-100 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 ${
                isFavorite ? "text-pink-400" : "text-slate-100"
              }`}
            >
              <HeartIcon filled={isFavorite} />
              <span className="sr-only sm:not-sr-only sm:text-xs">{isFavorite ? "Favorited" : "Favorite"}</span>
            </button>

            <button
              type="button"
              onClick={onToggleWatched}
              aria-label={watchedLabel}
              className={`inline-flex items-center gap-1 rounded-full border border-white/10 p-1.5 text-slate-100 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 ${
                watched ? "text-emerald-300" : "text-slate-100"
              }`}
            >
              <CheckIcon filled={watched} />
              <span className="sr-only sm:not-sr-only sm:text-xs">{watched ? "Watched" : "Watch"}</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};

export default MovieCard;
export type { MovieCardProps };

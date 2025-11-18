import React from "react";

type MovieCardProps = {
  posterUrl: string;
  title: string;
  year: string | number;
  imdbScore: number;
  rtScore: number;
  favorited: boolean;
  watched: boolean;
  onToggleFavorited?: () => void;
  onToggleWatched?: () => void;
};

const HeartIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg
    aria-hidden
    className="h-5 w-5"
    viewBox="0 0 24 24"
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
    className="h-5 w-5"
    viewBox="0 0 24 24"
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
  imdbScore,
  rtScore,
  favorited,
  watched,
  onToggleFavorited,
  onToggleWatched,
}) => {
  const favoriteLabel = favorited ? "Unfavorite movie" : "Favorite movie";
  const watchedLabel = watched ? "Mark as unwatched" : "Mark as watched";

  return (
    <article
      className="group relative flex aspect-[2/3] w-full overflow-hidden rounded-xl shadow-lg transition duration-200 ease-out hover:scale-[1.02] hover:shadow-xl"
    >
      <img
        src={posterUrl}
        alt={`${title} poster`}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />

      <div className="relative mt-auto w-full p-3 sm:p-4">
        <div className="rounded-xl border border-white/10 bg-black/50 backdrop-blur-md shadow-inner">
          <div className="space-y-2 p-3 text-white sm:p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight sm:text-base">{title}</p>
                <p className="text-xs text-slate-200/80 sm:text-sm">{year}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-100/90 sm:text-sm">
              <span className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-1 shadow-inner">IMDb {imdbScore.toFixed(1)}</span>
              <span className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-1 shadow-inner">RT {rtScore}%</span>
            </div>

            <div className="flex items-center gap-2 text-xs sm:text-sm">
              <button
                type="button"
                onClick={onToggleFavorited}
                aria-label={favoriteLabel}
                className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-white/10 px-3 py-2 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 hover:bg-white/10 ${
                  favorited ? "text-pink-400" : "text-slate-100"
                }`}
              >
                <HeartIcon filled={favorited} />
                <span className="sr-only sm:not-sr-only sm:text-xs">{favorited ? "Favorited" : "Favorite"}</span>
              </button>

              <button
                type="button"
                onClick={onToggleWatched}
                aria-label={watchedLabel}
                className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-white/10 px-3 py-2 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 hover:bg-white/10 ${
                  watched ? "text-emerald-300" : "text-slate-100"
                }`}
              >
                <CheckIcon filled={watched} />
                <span className="sr-only sm:not-sr-only sm:text-xs">{watched ? "Watched" : "Watch"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};

export default MovieCard;
export type { MovieCardProps };

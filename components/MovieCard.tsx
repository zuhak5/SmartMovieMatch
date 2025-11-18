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

const HeartIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    aria-hidden
    className="h-5 w-5"
    viewBox="0 0 24 24"
    fill={active ? "currentColor" : "none"}
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

const CheckIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg
    aria-hidden
    className="h-5 w-5"
    viewBox="0 0 24 24"
    fill={active ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={1.8}
  >
    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
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
  const favoriteLabel = Favorite ? "Unfavorite movie" : "Favorite movie";
  const watchedLabel = watched ? "Mark as unwatched" : "Mark as watched";

  return (
    <article
      className="relative flex min-h-[180px] w-full overflow-hidden rounded-xl border border-white/10 bg-white/10 shadow-lg backdrop-blur-md transition duration-200 ease-out hover:scale-[1.02] hover:shadow-xl"
    >
      <div className="basis-1/3 max-w-[40%] min-w-[120px] overflow-hidden">
        <img
          src={posterUrl}
          alt={`${title} poster`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3 text-white sm:p-4">
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-base font-semibold leading-tight sm:text-lg">{title}</h3>
            <span className="text-xs text-slate-300 sm:text-sm">{year}</span>
          </div>
          {description ? (
            <p className="text-sm text-slate-300 line-clamp-2 sm:line-clamp-3">{description}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-100 sm:text-sm">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1">
            <span className="text-[0.7rem] uppercase tracking-wide text-slate-200">IMDb</span>
            <span className="font-semibold">{imdbScore.toFixed(1)}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1">
            <span className="text-[0.7rem] uppercase tracking-wide text-slate-200">RT</span>
            <span className="font-semibold">{rtScore}%</span>
          </span>
        </div>

        <div className="mt-auto flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-label={favoriteLabel}
            className={`inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 hover:bg-white/10 ${
              Favorite ? "bg-pink-500/20 text-pink-300" : "text-slate-100"
            }`}
          >
            <HeartIcon active={Favorite} />
            <span className="sr-only sm:not-sr-only sm:text-xs">{Favorite ? "Favorited" : "Favorite"}</span>
          </button>

          <button
            type="button"
            onClick={onToggleWatched}
            aria-label={watchedLabel}
            className={`inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 hover:bg-white/10 ${
              watched ? "bg-emerald-500/20 text-emerald-200" : "text-slate-100"
            }`}
          >
            <CheckIcon active={watched} />
            <span className="sr-only sm:not-sr-only sm:text-xs">{watched ? "Watched" : "Watch"}</span>
          </button>
        </div>
      </div>
    </article>
  );
};

export default MovieCard;
export type { MovieCardProps };

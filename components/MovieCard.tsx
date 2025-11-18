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
    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Badge: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-white/90 shadow-inner ring-1 ring-white/10">
    <span className="uppercase tracking-wide text-[10px] text-white/70">{label}</span>
    <span>{value}</span>
  </span>
);

const ActionButton: React.FC<{
  active: boolean;
  onClick?: () => void;
  ariaLabel: string;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, ariaLabel, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 hover:bg-white/10 ${
      active ? "text-emerald-300" : "text-slate-100"
    }`}
  >
    <span className="text-base leading-none">{icon}</span>
    <span className="sr-only sm:not-sr-only">{label}</span>
  </button>
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
  const favoriteLabel = Favorite ? "Remove from favorites" : "Add to favorites";
  const watchedLabel = watched ? "Mark as unwatched" : "Mark as watched";

  return (
    <article
      className="group relative flex w-full overflow-hidden rounded-xl border border-white/10 bg-white/10 shadow-lg backdrop-blur-md transition duration-200 ease-out hover:scale-[1.02] hover:shadow-xl"
    >
      <div className="relative basis-2/5 min-w-[35%] max-w-[40%]">
        <img
          src={posterUrl}
          alt={`${title} poster`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/20 to-transparent" aria-hidden />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 truncate text-sm font-semibold text-white sm:text-base">{title}</h3>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-slate-200 ring-1 ring-white/10">
              {year}
            </span>
          </div>
          {description ? (
            <p className="text-xs text-slate-300 line-clamp-2 sm:text-sm">{description}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Badge label="IMDb" value={imdbScore.toFixed(1)} />
          <Badge label="RT" value={`${rtScore}%`} />
        </div>

        <div className="mt-auto flex items-center justify-end gap-2">
          <ActionButton
            active={Favorite}
            onClick={onToggleFavorite}
            ariaLabel={favoriteLabel}
            icon={<HeartIcon filled={Favorite} />}
            label={Favorite ? "Favorited" : "Favorite"}
          />
          <ActionButton
            active={watched}
            onClick={onToggleWatched}
            ariaLabel={watchedLabel}
            icon={<CheckIcon filled={watched} />}
            label={watched ? "Watched" : "Watch"}
          />
        </div>
      </div>
    </article>
  );
};

export default MovieCard;
export type { MovieCardProps };

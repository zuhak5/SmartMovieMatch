export const FALLBACK_TRENDING_MOVIES = [
  {
    title: "The Midnight Library",
    release_year: 2024,
    poster_url: "https://via.placeholder.com/342x513.png?text=Midnight+Library",
    synopsis: "A small-town librarian uncovers a secret film society that meets after hours to screen forgotten classics.",
    trend_score: 87.3,
    genres: ["Drama", "Mystery"],
    time_window: "weekly"
  },
  {
    title: "Signal Lost",
    release_year: 2023,
    poster_url: "https://via.placeholder.com/342x513.png?text=Signal+Lost",
    synopsis: "A deep-space engineer races to reboot a failing relay before a rescue mission disappears from contact.",
    trend_score: 82.5,
    genres: ["Science Fiction", "Thriller"],
    time_window: "weekly"
  },
  {
    title: "Harbor Lights",
    release_year: 2022,
    poster_url: "https://via.placeholder.com/342x513.png?text=Harbor+Lights",
    synopsis: "A chef returns home to revive a family restaurant and confront the folklore of a lighthouse apparition.",
    trend_score: 79.1,
    genres: ["Romance", "Drama"],
    time_window: "weekly"
  },
  {
    title: "Paper Planets",
    release_year: 2021,
    poster_url: "https://via.placeholder.com/342x513.png?text=Paper+Planets",
    synopsis: "Kids build cardboard spacecraft during a citywide blackout and spark a neighborhood adventure.",
    trend_score: 77.9,
    genres: ["Family", "Adventure"],
    time_window: "weekly"
  }
];

export const FALLBACK_DISCOVER_MOVIES = [
  {
    title: "Clockwork Chords",
    release_year: 2023,
    poster_url: "https://via.placeholder.com/342x513.png?text=Clockwork+Chords",
    synopsis: "A synth musician discovers their melodies can physically bend time inside an abandoned observatory.",
    vote_average: 7.4,
    genres: ["Music", "Fantasy"],
    streamingProviders: [
      { key: "netflix", name: "Netflix", region: "US", brandColor: "#e50914" },
      { key: "prime", name: "Prime Video", region: "US", brandColor: "#00a8e1" }
    ]
  },
  {
    title: "Vanishing Point",
    release_year: 2022,
    poster_url: "https://via.placeholder.com/342x513.png?text=Vanishing+Point",
    synopsis: "Detectives trace a series of art heists to a mural that changes every full moon.",
    vote_average: 7.9,
    genres: ["Crime", "Mystery"],
    streamingProviders: [
      { key: "hulu", name: "Hulu", region: "US", brandColor: "#3dbb3d" },
      { key: "kanopy", name: "Kanopy", region: "Library" }
    ]
  },
  {
    title: "Northern Lullaby",
    release_year: 2021,
    poster_url: "https://via.placeholder.com/342x513.png?text=Northern+Lullaby",
    synopsis: "An ice-road driver and a radio host form an unlikely duo to guide travelers through a storm.",
    vote_average: 7.1,
    genres: ["Adventure", "Drama"],
    streamingProviders: [
      { key: "disney", name: "Disney+", region: "US", brandColor: "#113ccf" }
    ]
  }
];

export const FALLBACK_PEOPLE = [
  {
    name: "Lena Hart",
    known_for: [
      { title: "Northern Lullaby" },
      { title: "Glasshouse Echoes" }
    ]
  },
  {
    name: "Milo Reyes",
    known_for: [
      { title: "Signal Lost" },
      { title: "Clockwork Chords" }
    ]
  },
  {
    name: "Aria Bennett",
    known_for: [
      { title: "Harbor Lights" },
      { title: "Paper Planets" }
    ]
  }
];

export const FALLBACK_RECOMMENDATIONS = [
  {
    tmdb: {
      title: "River of Starlight",
      poster_path: "/placeholder-river-starlight.png",
      genre_ids: [18, 14],
      release_date: "2023-11-05",
      vote_average: 7.6
    },
    omdb: {
      Title: "River of Starlight",
      Year: "2023",
      Poster: "https://via.placeholder.com/342x513.png?text=River+of+Starlight",
      Plot: "An astronomer and a cartographer map a river whose currents mirror the constellations above."
    },
    candidate: { title: "River of Starlight" }
  },
  {
    tmdb: {
      title: "Afterimage",
      poster_path: "/placeholder-afterimage.png",
      genre_ids: [53, 9648],
      release_date: "2024-02-14",
      vote_average: 7.8
    },
    omdb: {
      Title: "Afterimage",
      Year: "2024",
      Poster: "https://via.placeholder.com/342x513.png?text=Afterimage",
      Plot: "A forensic photographer uncovers hidden clues that only appear in overexposed film."
    },
    candidate: { title: "Afterimage" }
  },
  {
    tmdb: {
      title: "Garden Station",
      poster_path: "/placeholder-garden-station.png",
      genre_ids: [35, 10749],
      release_date: "2022-08-28",
      vote_average: 7.2
    },
    omdb: {
      Title: "Garden Station",
      Year: "2022",
      Poster: "https://via.placeholder.com/342x513.png?text=Garden+Station",
      Plot: "Two strangers renovate an abandoned train stop into a community greenhouse and find family along the way."
    },
    candidate: { title: "Garden Station" }
  }
];

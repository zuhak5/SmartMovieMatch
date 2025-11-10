// api/tmdb.js
const ALLOWED_PATHS = new Set([
  "discover/movie",
  "search/movie",
  "trending/movie/week"
]);

module.exports = async (req, res) => {
  try {
    const { query = {} } = req;
    const { path = "discover/movie", ...rest } = query;

    if (!ALLOWED_PATHS.has(path)) {
      res.status(400).json({ error: "Unsupported TMDB path" });
      return;
    }

    const baseUrl = `https://api.themoviedb.org/3/${path}`;
    const params = new URLSearchParams();
    params.set("api_key", process.env.TMDB_API_KEY);

    const language = rest.language || "en-US";
    if (language) {
      params.set("language", language);
    }

    if (!Object.prototype.hasOwnProperty.call(rest, "include_adult")) {
      params.set("include_adult", "false");
    }

    Object.entries(rest).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }
      if (key === "language") {
        params.set("language", value);
        return;
      }
      if (key === "include_adult") {
        params.set("include_adult", value);
        return;
      }
      params.set(key, value);
    });

    const response = await fetch(`${baseUrl}?${params.toString()}`);
    const data = await response.json();

    res.status(response.status).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "TMDB proxy error" });
  }
};

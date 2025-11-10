// api/youtube.js
module.exports = async (req, res) => {
  try {
    const { query } = req;

    const baseUrl = "https://www.googleapis.com/youtube/v3/search";

    const params = new URLSearchParams();
    params.set("key", process.env.YOUTUBE_API_KEY);
    params.set("part", "snippet");
    params.set("type", "video");
    params.set("maxResults", (query && query.maxResults) || "1");

    Object.entries(query || {}).forEach(([key, value]) => {
      if (key.toLowerCase() === "key") return;
      if (value === undefined || value === null) return;
      params.set(key, value);
    });

    const response = await fetch(`${baseUrl}?${params.toString()}`);
    const data = await response.json();

    res.status(response.status).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "YouTube proxy error" });
  }
};

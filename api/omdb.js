// api/omdb.js
module.exports = async (req, res) => {
  try {
    const { query } = req;

    const baseUrl = "https://www.omdbapi.com/";
    const params = new URLSearchParams();
    params.set("apikey", process.env.OMDB_API_KEY);

    Object.entries(query || {}).forEach(([key, value]) => {
      if (key.toLowerCase() === "apikey") return;
      if (value === undefined || value === null) return;
      params.set(key, value);
    });

    const response = await fetch(`${baseUrl}?${params.toString()}`);
    const data = await response.json();

    res.status(response.status).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OMDb proxy error" });
  }
};

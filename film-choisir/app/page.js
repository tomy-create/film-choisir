"use client";

import { useState } from "react";
import { GENRES } from "@/lib/genres";

export default function Home() {
  const [genreId, setGenreId] = useState("");
  const [actor, setActor] = useState("");
  const [director, setDirector] = useState("");
  const [keywords, setKeywords] = useState("");
  const [limit, setLimit] = useState("5");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

async function handleSubmit(e) {
  e.preventDefault();
  setLoading(true);
  setError(null);
  setResults(null);
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genreId, actor, director, keywords, limit }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur inconnue");
    setResults(data.results);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
}

return (
  <main>
  <h1>Quel film regarder ?</h1>
  <p className="subtitle">
  Décris ce que tu as envie de voir, choisis combien de films tu veux voir.
  </p>

<form onSubmit={handleSubmit}>
  <div>
  <label htmlFor="genre">Genre</label>
  <select id="genre" value={genreId} onChange={(e) => setGenreId(e.target.value)}>
<option value="">Peu importe</option>
{GENRES.map((g) => (
  <option key={g.id} value={g.id}>{g.name}</option>
))}
  </select>
  </div>

<div>
  <label htmlFor="actor">Acteur / actrice</label>
<input
id="actor"
type="text"
placeholder="ex : Marion Cotillard"
value={actor}
onChange={(e) => setActor(e.target.value)}
/>
  </div>

<div>
  <label htmlFor="director">Réalisateur·rice</label>
<input
id="director"
type="text"
placeholder="ex : Denis Villeneuve"
value={director}
onChange={(e) => setDirector(e.target.value)}
/>
  </div>

<div>
  <label htmlFor="keywords">Description libre (optionnel)</label>
<input
id="keywords"
type="text"
placeholder="ex : film de braquage haletant"
value={keywords}
onChange={(e) => setKeywords(e.target.value)}
/>
  </div>

<div>
  <label htmlFor="limit">Nombre de films</label>
<select id="limit" value={limit} onChange={(e) => setLimit(e.target.value)}>
<option value="5">5</option>
<option value="10">10</option>
<option value="illimite">Illimité (jusqu'à 50)</option>
  </select>
  </div>

<button type="submit" disabled={loading}>
{loading ? "Recherche en cours..." : "Trouver un film"}
</button>
  </form>

{error && <p className="error">{error}</p>}

 {results && (
   <div className="results">
 {results.length === 0 && <p>Aucun film trouvé, essaie d'élargir ta recherche.</p>}
 {results.map((movie) => (
   <div className="movie-card" key={movie.id}>
 {movie.posterUrl ? (
   <img src={movie.posterUrl} alt={movie.title} />
  ) : (
    <div />
    )}
 <div>
   <h3>{movie.title} {movie.releaseDate ? `(${movie.releaseDate.slice(0, 4)})` : ""}</h3>
<div className="ratings">
{movie.imdbRating && <span>⭐ IMDb : {movie.imdbRating}/10</span>}
{movie.rottenTomatoes && <span>🍅 Rotten Tomatoes : {movie.rottenTomatoes}</span>}
{!movie.imdbRating && !movie.rottenTomatoes && (
  <span>TMDB : {movie.tmdbRating?.toFixed(1)}/10</span>
  )}
</div>
<p className="overview">{movie.overview}</p>
  </div>
  </div>
))}
  </div>
)}
</main>
);
}

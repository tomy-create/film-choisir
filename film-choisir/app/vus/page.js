"use client";

import { useEffect, useState } from "react";

export default function FilmsVus() {
    const [seen, setSeen] = useState(null);
    const [error, setError] = useState(null);
    const [removingIds, setRemovingIds] = useState(new Set());

  async function load() {
        try {
                const res = await fetch("/api/seen", { cache: "no-store" });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur inconnue");
                setSeen(data.seen);
        } catch (err) {
                setError(err.message);
        }
  }

  useEffect(() => {
        load();
  }, []);

  async function handleRemove(movieId) {
        setRemovingIds((prev) => new Set(prev).add(movieId));
        try {
                const res = await fetch("/api/seen", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ movieId }),
                });
                if (!res.ok) throw new Error("Erreur lors de la suppression");
                setSeen((prev) => prev.filter((m) => m.id !== movieId));
        } catch (err) {
                setError(err.message);
        } finally {
                setRemovingIds((prev) => {
                          const next = new Set(prev);
                          next.delete(movieId);
                          return next;
                });
        }
  }

  return (
        <main>
          <a className="back-link" href="/">
            &larr; Retour a la recherche
    </a>
        <h1>Films vus</h1>
        <p className="subtitle">
            Ces films ne seront plus proposes dans tes recherches. Tu peux
          decocher un film ici si tu l&apos;as marque comme vu par erreur.
            </p>

  {error && <p className="error">{error}</p>}
   {seen === null && !error && <p>Chargement...</p>}
    {seen && seen.length === 0 && (
              <p>Aucun film marque comme vu pour l&apos;instant.</p>
           )}

    {seen && seen.length > 0 && (
              <div className="results">
    {seen.map((movie) => (
                  <div className="movie-card" key={movie.id}>
    {movie.posterUrl ? (
                      <img src={movie.posterUrl} alt={movie.title} />
                  ) : (
                                    <div />
                                  )}
                 <div>
                                   <h3>{movie.title}</h3>
                   <button
                     className="unsee-button"
                     disabled={removingIds.has(movie.id)}
                    onClick={() => handleRemove(movie.id)}
                  >
                    {removingIds.has(movie.id)
                      ? "Suppression..."
                                          : "Decocher (marquer comme non vu)"}
</button>
  </div>
  </div>
          ))}
            </div>
      )}
</main>
  );
}

import { NextResponse } from "next/server";

const TMDB_BASE = "https://api.themoviedb.org/3";
const OMDB_BASE = "https://www.omdbapi.com/";

async function tmdbFetch(path, params = {}) {
    const url = new URL(TMDB_BASE + path);
    url.searchParams.set("api_key", process.env.TMDB_API_KEY);
    url.searchParams.set("language", "fr-FR");
    for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null && value !== "") {
                  url.searchParams.set(key, value);
          }
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
          throw new Error(`Erreur TMDB (${res.status}) sur ${path}`);
    }
    return res.json();
}

async function findPersonId(name) {
    if (!name || !name.trim()) return null;
    const data = await tmdbFetch("/search/person", { query: name });
    return data.results && data.results.length > 0 ? data.results[0].id : null;
}

async function getActorMovies(personId) {
    if (!personId) return null;
    const data = await tmdbFetch(`/person/${personId}/movie_credits`);
    return data.cast || [];
}

async function getDirectorMovies(personId) {
    if (!personId) return null;
    const data = await tmdbFetch(`/person/${personId}/movie_credits`);
    return (data.crew || []).filter((c) => c.job === "Director");
}

async function getImdbId(movieId) {
    const data = await tmdbFetch(`/movie/${movieId}/external_ids`);
    return data.imdb_id || null;
}

async function getRatings(imdbId) {
    if (!imdbId || !process.env.OMDB_API_KEY) {
          return { imdbRating: null, rottenTomatoes: null };
    }
    try {
          const url = new URL(OMDB_BASE);
          url.searchParams.set("i", imdbId);
          url.searchParams.set("apikey", process.env.OMDB_API_KEY);
          const res = await fetch(url.toString());
          const data = await res.json();
          const rtEntry = (data.Ratings || []).find(
                  (r) => r.Source === "Rotten Tomatoes"
                );
          return {
                  imdbRating: data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null,
                  rottenTomatoes: rtEntry ? rtEntry.Value : null,
          };
    } catch {
          return { imdbRating: null, rottenTomatoes: null };
    }
}

function dedupeById(movies) {
    const seen = new Set();
    const out = [];
    for (const m of movies) {
          if (!seen.has(m.id)) {
                  seen.add(m.id);
                  out.push(m);
          }
    }
    return out;
}

export async function POST(request) {
    try {
          if (!process.env.TMDB_API_KEY) {
                  return NextResponse.json(
                    { error: "La clé API TMDB n'est pas configurée sur le serveur." },
                    { status: 500 }
                          );
          }

      const body = await request.json();
          const { genreId, actor, director, keywords } = body;
          const hasKeywords = keywords && keywords.trim();
          const genreNum = genreId ? Number(genreId) : null;

      const [actorId, directorId] = await Promise.all([
              findPersonId(actor),
              findPersonId(director),
            ]);
          const [actorMovies, directorMovies] = await Promise.all([
                  getActorMovies(actorId),
                  getDirectorMovies(directorId),
                ]);
          const actorMovieIds = actorMovies ? new Set(actorMovies.map((m) => m.id)) : null;
          const directorMovieIds = directorMovies ? new Set(directorMovies.map((m) => m.id)) : null;

      let candidates;
          if (hasKeywords) {
                  const data = await tmdbFetch("/search/movie", { query: keywords });
                  candidates = data.results || [];
          } else if (actorMovies) {
                  candidates = actorMovies;
          } else if (directorMovies) {
                  candidates = directorMovies;
          } else {
                  const discoverParams = {
                            sort_by: "popularity.desc",
                            include_adult: "false",
                            "vote_count.gte": "50",
                  };
                  if (genreNum) discoverParams.with_genres = genreNum;
                  const data = await tmdbFetch("/discover/movie", discoverParams);
                  candidates = data.results || [];
          }

      candidates = dedupeById(candidates);

      if (actorMovieIds) {
              candidates = candidates.filter((m) => actorMovieIds.has(m.id));
      }
          if (directorMovieIds) {
                  candidates = candidates.filter((m) => directorMovieIds.has(m.id));
          }
          if (genreNum) {
                  candidates = candidates.filter((m) => m.genre_ids?.includes(genreNum));
          }

      candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

      const top5 = candidates.slice(0, 5);

      const enriched = await Promise.all(
              top5.map(async (movie) => {
                        const imdbId = await getImdbId(movie.id);
                        const ratings = await getRatings(imdbId);
                        return {
                                    id: movie.id,
                                    title: movie.title,
                                    overview: movie.overview,
                                    releaseDate: movie.release_date,
                                    posterUrl: movie.poster_path
                                      ? `https://image.tmdb.org/t/p/w342${movie.poster_path}`
                                                  : null,
                                    tmdbRating: movie.vote_average,
                                    imdbId,
                                    imdbRating: ratings.imdbRating,
                                    rottenTomatoes: ratings.rottenTomatoes,
                        };
              })
            );

      return NextResponse.json({ results: enriched });
    } catch (err) {
          console.error(err);
          return NextResponse.json(
            { error: "Une erreur est survenue pendant la recherche." },
            { status: 500 }
                );
    }
}

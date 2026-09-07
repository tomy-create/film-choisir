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
  if (!name) return null;
  const data = await tmdbFetch("/search/person", { query: name });
  return data.results && data.results.length > 0 ? data.results[0].id : null;
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

    const [actorId, directorId] = await Promise.all([
      findPersonId(actor),
      findPersonId(director),
    ]);

    let results = [];

    if (keywords && keywords.trim()) {
      // Recherche textuelle libre (titre, ambiance, mots-clés en langage naturel)
      const data = await tmdbFetch("/search/movie", { query: keywords });
      results = data.results || [];
    } else {
      const discoverParams = {
        sort_by: "popularity.desc",
        include_adult: "false",
        "vote_count.gte": "50",
      };
      if (genreId) discoverParams.with_genres = genreId;
      if (actorId) discoverParams.with_cast = actorId;
      if (directorId) discoverParams.with_crew = directorId;
      const data = await tmdbFetch("/discover/movie", discoverParams);
      results = data.results || [];
    }

    // Si une recherche libre a été utilisée mais qu'on a aussi un genre/acteur/réalisateur,
    // on filtre les résultats texte pour ne garder que ceux qui correspondent au genre demandé.
    if (keywords && genreId) {
      results = results.filter((m) => m.genre_ids?.includes(Number(genreId)));
    }

    const top5 = results.slice(0, 5);

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

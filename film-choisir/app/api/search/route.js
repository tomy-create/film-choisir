import { NextResponse } from "next/server";
import { getSeenMovieIds } from "@/lib/db";

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

// Récupère plusieurs pages d'un même endpoint TMDB paginé (utile quand on
// veut plus de 20 résultats, la taille d'une page TMDB) et les concatène.
async function tmdbFetchPages(path, params, pageCount) {
        const pages = await Promise.all(
                  Array.from({ length: pageCount }, (_, i) =>
                              tmdbFetch(path, { ...params, page: String(i + 1) })
                                 )
                );
        return pages.flatMap((p) => p.results || []);
}

async function findPersonId(name) {
        if (!name || !name.trim()) return null;
        const data = await tmdbFetch("/search/person", { query: name });
        return data.results && data.results.length > 0 ? data.results[0].id : null;
}

// Renvoie la liste des films où cette personne est créditée comme actrice/acteur.
async function getActorMovies(personId) {
        if (!personId) return null;
        const data = await tmdbFetch(`/person/${personId}/movie_credits`);
        return data.cast || [];
}

// Renvoie la liste des films que cette personne a réellement réalisés
// (on filtre précisément sur job === "Director", pas juste "a un rôle technique").
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

// Certaines fiches TMDB sont des entrées quasi vides / douteuses (0 vote,
// aucune affiche, crédits parfois errones) qui polluent les résultats sans
// être de vrais films connus (ex : "Civilware 2025"). On les écarte.
function isLikelyRealMovie(m) {
        return Boolean(m.poster_path) && (m.vote_count || 0) >= 1;
}

// TMDB ne fait qu'une recherche littérale sur les titres : une description
// d'ambiance ("un film de braquage haletant") ne matche presque jamais un
// titre. On complète donc avec un petit dictionnaire de thèmes courants
// vers des genres, pour élargir la recherche libre au-delà du titre exact.
const THEME_TO_GENRES = [
      { words: ["braquage", "casse", "hold-up", "holdup"], genres: [80, 53] },
      { words: ["espace", "spatial", "galaxie", "extraterrestre"], genres: [878] },
      { words: ["amour", "romantique", "romance"], genres: [10749] },
      { words: ["peur", "effrayant", "flippant", "horreur", "épouvante"], genres: [27] },
      { words: ["drôle", "rire", "comique", "rigolo"], genres: [35] },
      { words: ["guerre", "militaire", "soldat"], genres: [10752] },
      { words: ["enquête", "policier", "détective", "meurtre"], genres: [9648, 80] },
      { words: ["super-héros", "super héros", "superhéros"], genres: [28] },
      { words: ["zombie", "apocalypse", "survie"], genres: [27, 878] },
      { words: ["voyage dans le temps", "temporel"], genres: [878] },
      { words: ["danse", "musique", "musical"], genres: [10402] },
      { words: ["famille", "enfant", "enfants"], genres: [10751] },
      ];

function genresFromFreeText(text) {
        const lower = text.toLowerCase();
        const genres = new Set();
        for (const entry of THEME_TO_GENRES) {
                  if (entry.words.some((w) => lower.includes(w))) {
                              entry.genres.forEach((g) => genres.add(g));
                  }
        }
        return [...genres];
}

// Complément au dictionnaire de thèmes : on interroge directement les
// "mots-clés" TMDB (ex : "dinosaur", "time travel"...) avec le texte libre
// tel quel. La recherche de mots-clés TMDB tolère bien le français proche
// de l'anglais (ex : "dinosaure" retrouve le mot-clé "dinosaur"), ce qui
// permet de couvrir plein de sujets précis sans dictionnaire à la main.
// Mots trop courants pour être utiles à une recherche de mot-clé (ils
// noient le vrai sujet de la phrase, ex: "dinosaures" dans "film avec des
// dinosaures"). On les retire pour interroger aussi chaque mot important
// séparément, en plus de la phrase complète.
const STOPWORDS_FR = new Set([
        "film", "films", "avec", "sans", "des", "un", "une", "de", "la", "le", "les",
        "du", "au", "aux", "et", "ou", "dans", "sur", "pour", "qui", "que", "quel",
        "quelle", "ca", "sa", "ses", "mon", "ma", "mes", "ton", "ta", "tes", "notre",
        "nos", "votre", "vos", "leur", "leurs", "il", "elle", "ils", "elles", "est",
        "sont", "tres", "plus", "comme", "style", "genre", "type", "quelque", "chose",
      ]);

async function keywordIdsFromFreeText(text) {
        const ids = new Set();

  try {
            const full = await tmdbFetch("/search/keyword", { query: text });
            (full.results || []).slice(0, 5).forEach((k) => ids.add(k.id));
  } catch {
            // on continue avec les mots individuels même si la phrase complète échoue
  }

  const words = text
          .toLowerCase()
          .split(/[^a-zàâäéèêëïîôöùûüç0-9-]+/i)
          .filter((w) => w.length > 3 && !STOPWORDS_FR.has(w));
        const uniqueWords = [...new Set(words)].slice(0, 4);

  const results = await Promise.all(
            uniqueWords.map((w) =>
                        tmdbFetch("/search/keyword", { query: w }).catch(() => ({ results: [] }))
                                )
          );
        // On garde plusieurs correspondances par mot : le meilleur mot-clé (le plus
  // générique, souvent le plus riche en films connus, ex. "dinosaur") n'est
  // pas toujours le tout premier résultat renvoyé par TMDB.
  results.forEach((r) => (r.results || []).slice(0, 6).forEach((k) => ids.add(k.id)));

  return [...ids].slice(0, 15);
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
                  const actorTrimmed = (body.actor || "").trim();
                  const directorTrimmed = (body.director || "").trim();
                  const keywordsTrimmed = (body.keywords || "").trim();
                  const hasKeywords = keywordsTrimmed.length > 0;
                  const genreNum = body.genreId ? Number(body.genreId) : null;

          // Nombre de films à renvoyer : 5, 10, ou "illimité" (en pratique on
          // plafonne quand même à 50, sinon la recherche devient très lente et
          // TMDB ne fournit de toute façon pas un nombre infini de films pertinents).
          const limitMap = { "5": 5, "10": 10, illimite: 50 };
                  const limitNum = limitMap[body.limit] || 5;
                  // Nombre de pages TMDB (20 résultats/page) à récupérer pour avoir assez
          // de candidats bruts avant filtrage, sans multiplier les appels inutilement.
          const pageCount = Math.min(3, Math.max(1, Math.ceil(limitNum / 20)));

          // On résout les noms en identifiants TMDB, et on récupère directement
          // la filmographie complète de chacun (fiable, pas d'ambiguïté sur les rôles).
          const [actorId, directorId] = await Promise.all([
                      findPersonId(actorTrimmed),
                      findPersonId(directorTrimmed),
                    ]);

          // Si un nom a été saisi mais ne correspond à personne sur TMDB, mieux
          // vaut le dire clairement que de proposer des films populaires sans
          // rapport : on renvoie une liste vide plutôt qu'un faux positif.
          if ((actorTrimmed && !actorId) || (directorTrimmed && !directorId)) {
                      return NextResponse.json({ results: [] });
          }

          const [actorMovies, directorMovies] = await Promise.all([
                      getActorMovies(actorId),
                      getDirectorMovies(directorId),
                    ]);
                  const actorMovieIds = actorMovies ? new Set(actorMovies.map((m) => m.id)) : null;
                  const directorMovieIds = directorMovies ? new Set(directorMovies.map((m) => m.id)) : null;

          // On choisit la liste de départ la plus pertinente, puis on la
          // restreint avec chacun des autres critères fournis (au lieu de ne
          // combiner que deux critères à la fois).
          let candidates;
                  if (hasKeywords) {
                              const searchData = await tmdbFetchPages(
                                            "/search/movie",
                                    { query: keywordsTrimmed },
                                            Math.min(pageCount, 2)
                                          );
                              candidates = searchData;

                    // La recherche littérale TMDB rate souvent les descriptions d'ambiance :
                    // on complète avec les genres associés aux thèmes reconnus dans le texte,
                    // ainsi qu'avec les mots-clés TMDB correspondant au texte libre.
                    const [inferredGenres, keywordIds] = await Promise.all([
                                  Promise.resolve(genresFromFreeText(keywordsTrimmed)),
                                  keywordIdsFromFreeText(keywordsTrimmed),
                                ]);

                    if (inferredGenres.length > 0) {
                                  const discoverByGenre = await tmdbFetchPages(
                                                  "/discover/movie",
                                        {
                                                          sort_by: "popularity.desc",
                                                          include_adult: "false",
                                                          "vote_count.gte": "50",
                                                          with_genres: inferredGenres.join(","),
                                        },
                                                  pageCount
                                                );
                                  candidates = [...candidates, ...discoverByGenre];
                    }

                    if (keywordIds.length > 0) {
                                  const discoverByKeyword = await tmdbFetchPages(
                                                  "/discover/movie",
                                        {
                                                          sort_by: "popularity.desc",
                                                          include_adult: "false",
                                                          "vote_count.gte": "10",
                                                          with_keywords: keywordIds.join("|"),
                                        },
                                                  pageCount
                                                );
                                  candidates = [...candidates, ...discoverByKeyword];
                    }
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
                              candidates = await tmdbFetchPages("/discover/movie", discoverParams, pageCount);
                  }

          candidates = dedupeById(candidates);
                  candidates = candidates.filter(isLikelyRealMovie);

          // On retire les films déjà marqués comme "vus" pour ne pas les
          // reproposer. Si la base de données est indisponible, on continue
          // quand même la recherche plutôt que de faire planter le site.
          try {
                      const seenIds = await getSeenMovieIds();
                      if (seenIds.size > 0) {
                                    candidates = candidates.filter((m) => !seenIds.has(m.id));
                      }
          } catch (err) {
                      console.error("Impossible de récupérer les films vus:", err);
          }

          if (actorMovieIds) {
                      candidates = candidates.filter((m) => actorMovieIds.has(m.id));
          }
                  if (directorMovieIds) {
                              candidates = candidates.filter((m) => directorMovieIds.has(m.id));
                  }
                  if (genreNum) {
                              candidates = candidates.filter((m) => m.genre_ids?.includes(genreNum));
                  }

          // Tri par popularité décroissante (les films les plus connus en premier).
          candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

          const topN = candidates.slice(0, limitNum);

          const enriched = await Promise.all(
                      topN.map(async (movie) => {
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

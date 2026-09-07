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

// Renvoie la liste des films où cette personne est créditée comme actrice/acteur.
async function getActorMovies(personId) {
    if (!personId) return null;
    const data = await tmdbFetch(`/person/${personId}/movie_credits`);
    return data.cast || [];
}

// Renvoie la liste des films que cette personne a réellement réalisés
// (on filtre precisément sur job === "Director", pas juste "a un rôle technique").
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
            const data = await tmdbFetch("/search/movie", { query: keywordsTrimmed });
            candidates = data.results || [];

        // La recherche littérale TMDB rate souvent les descriptions d'ambiance :
        // on complète avec les genres associés aux thèmes reconnus dans le texte.
        const inferredGenres = genresFromFreeText(keywordsTrimmed);
            if (inferredGenres.length > 0) {
                const discoverData = await tmdbFetch("/discover/movie", {
                    sort_by: "popularity.desc",
                    include_adult: "false",
                    "vote_count.gte": "50",
                    with_genres: inferredGenres.join(","),
                });
                candidates = [...candidates, ...(discoverData.results || [])];
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

    // Tri par popularité décroissante (les films les plus connus en premier).
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

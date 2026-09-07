import { sql } from "@vercel/postgres";

// On crée la table au premier appel si elle n'existe pas encore (rien à
// configurer à la main sur la base de données).
let tableReady = false;

async function ensureSeenTable() {
      if (tableReady) return;
      await sql`
          CREATE TABLE IF NOT EXISTS seen_movies (
                movie_id INTEGER PRIMARY KEY,
                      title TEXT,
                            poster_url TEXT,
                                  added_at TIMESTAMPTZ DEFAULT NOW()
                                      );
                                        `;
      tableReady = true;
}

export async function getSeenMovieIds() {
      await ensureSeenTable();
      const { rows } = await sql`SELECT movie_id FROM seen_movies;`;
      return new Set(rows.map((r) => r.movie_id));
}

export async function getSeenMovies() {
      await ensureSeenTable();
      const { rows } = await sql`
          SELECT movie_id, title, poster_url, added_at
              FROM seen_movies
                  ORDER BY added_at DESC;
                    `;
      return rows.map((r) => ({
              id: r.movie_id,
              title: r.title,
              posterUrl: r.poster_url,
              addedAt: r.added_at,
      }));
}

export async function markMovieSeen(movieId, title, posterUrl) {
      await ensureSeenTable();
      await sql`
          INSERT INTO seen_movies (movie_id, title, poster_url)
              VALUES (${movieId}, ${title || null}, ${posterUrl || null})
                  ON CONFLICT (movie_id) DO NOTHING;
                    `;
}

export async function unmarkMovieSeen(movieId) {
      await ensureSeenTable();
      await sql`DELETE FROM seen_movies WHERE movie_id = ${movieId};`;
}

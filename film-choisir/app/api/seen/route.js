import { NextResponse } from "next/server";
import { getSeenMovies, markMovieSeen, unmarkMovieSeen } from "@/lib/db";

export async function GET() {
      try {
              const seen = await getSeenMovies();
              return NextResponse.json({ seen });
      } catch (err) {
              console.error(err);
              return NextResponse.json(
                  { error: "Erreur lors de la récupération des films vus." },
                  { status: 500 }
                      );
      }
}

export async function POST(request) {
      try {
              const body = await request.json();
              const movieId = Number(body.movieId);
              if (!movieId) {
                        return NextResponse.json({ error: "movieId manquant." }, { status: 400 });
              }
              await markMovieSeen(movieId, body.title, body.posterUrl);
              return NextResponse.json({ ok: true });
      } catch (err) {
              console.error(err);
              return NextResponse.json(
                  { error: "Erreur lors de l'enregistrement." },
                  { status: 500 }
                      );
      }
}

export async function DELETE(request) {
      try {
              const body = await request.json();
              const movieId = Number(body.movieId);
              if (!movieId) {
                        return NextResponse.json({ error: "movieId manquant." }, { status: 400 });
              }
              await unmarkMovieSeen(movieId);
              return NextResponse.json({ ok: true });
      } catch (err) {
              console.error(err);
              return NextResponse.json(
                  { error: "Erreur lors de la suppression." },
                  { status: 500 }
                      );
      }
}

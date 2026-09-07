# Quel film regarder ?

Site pour trouver rapidement un film à regarder selon un genre, un acteur,
un réalisateur ou une description libre, avec les notes IMDb et Rotten
Tomatoes.

## Mise en ligne (sans terminal, tout depuis le navigateur)

1. Crée un compte gratuit sur https://github.com puis un nouveau dépôt
   (bouton "New repository"), par exemple nommé `film-choisir`.
2. Sur la page du dépôt, clique sur "uploading an existing file" et
   dépose tous les fichiers/dossiers de ce projet (en gardant la même
   structure de dossiers).
3. Crée un compte gratuit sur https://vercel.com en te connectant avec
   ton compte GitHub.
4. Sur Vercel, clique sur "Add New... -> Project", choisis ton dépôt
   `film-choisir` et clique sur "Import". Vercel détecte automatiquement
   qu'il s'agit d'un projet Next.js.
5. Avant de cliquer sur "Deploy", ouvre la section "Environment
   Variables" et ajoute :
   - `TMDB_API_KEY` avec ta clé obtenue sur https://www.themoviedb.org/settings/api
   - `OMDB_API_KEY` avec ta clé obtenue sur https://www.omdbapi.com/apikey.aspx
6. Clique sur "Deploy". Après une à deux minutes, Vercel te donne un
   lien (ex : `film-choisir.vercel.app`) où le site est accessible.

Pour chaque mise à jour du site, il suffira de réuploader les fichiers
modifiés sur GitHub (même méthode) : Vercel redéploie automatiquement.

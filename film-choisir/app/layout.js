import "./globals.css";

export const metadata = {
  title: "Quel film regarder ?",
  description: "Trouve un film à regarder selon tes envies",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

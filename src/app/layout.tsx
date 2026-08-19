import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muse AI — Your beauty operating system",
  description:
    "A personalized pink-tech beauty workspace built from your facial features, coloring, and celebrity styling references.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

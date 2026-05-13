import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Philosophy news — Parallel",
  description: "Recent philosophy coverage from reputable news sources via Parallel Search and Extract.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hypervision",
  description: "Central platform for creating, editing, and managing forms and responses",
  icons: {
    icon: [
      { url: "/hypervision-logo.png", type: "image/png" },
      { url: "/icon.png", type: "image/png" },
    ],
    shortcut: "/hypervision-logo.png",
    apple: "/hypervision-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" type="image/png" href="/hypervision-logo.png" />
        <link rel="shortcut icon" href="/hypervision-logo.png" />
        <link rel="apple-touch-icon" href="/hypervision-logo.png" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased bg-[#090e1a] text-slate-100 selection:bg-sky-500/20 selection:text-sky-300">
        {children}
      </body>
    </html>
  );
}

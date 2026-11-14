import type { Metadata, Viewport } from "next";
import { AppScript } from "./app-script";

export const metadata: Metadata = {
  title: "Cloud Chaser",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        {children}
        <AppScript />
      </body>
    </html>
  );
}

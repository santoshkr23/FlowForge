import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FlowForge — wire your apps together", template: "%s · FlowForge" },
  description: "Build automations and AI agents visually. Connect your apps, run on a schedule or a webhook, and pay only for what runs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

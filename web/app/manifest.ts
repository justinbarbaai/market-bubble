import type { MetadataRoute } from "next";

// PWA manifest — makes Market Bubble installable to the home screen (standalone,
// branded splash, app icon). Next serves this at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Market Bubble",
    short_name: "Market Bubble",
    description:
      "Live Thursdays 1PM PST — Banks & Ansem, one unified chat across Twitch, Kick & X, plus live markets.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3ebda",
    theme_color: "#f3ebda",
    categories: ["finance", "entertainment", "news"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

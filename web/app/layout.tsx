import type { Metadata, Viewport } from "next";
import {
  Inter,
  Montserrat,
  Poppins,
  Oswald,
  Anton,
  Playfair_Display,
  IBM_Plex_Mono,
} from "next/font/google";
import "./globals.css";
import { SiteFX } from "./components/SiteFX";
import { PlayerLayer } from "./components/PlayerLayer";
import { PremiumFX } from "./components/PremiumFX";
import { BottomNav } from "./components/BottomNav";
import { RegisterSW } from "./components/RegisterSW";

// Chat-overlay font choices, exposed as CSS variables and selectable per overlay.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
  variable: "--font-montserrat",
});
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
  variable: "--font-poppins",
});
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-oswald",
});
const anton = Anton({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-anton",
});
// Editorial display serif for the Market Bubble brand.
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-playfair",
});
// Terminal/grotesk numeric voice for the live data UI.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-mono",
});
const fontVars = [inter, montserrat, poppins, oswald, anton, playfair, plexMono]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  metadataBase: new URL("https://market-bubble-nine.vercel.app"),
  title: "Market Bubble — Make Money. Command Attention. Leverage AI.",
  description:
    "Market Bubble — live Thursdays 1PM PST. Watch Banks & Ansem, one unified chat across Twitch, Kick & X, live markets, and news.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Market Bubble", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// Without this, phones render the desktop layout at a ~980px layout viewport and
// shrink it to fit (tiny, zoomed-out) and the responsive @media rules never match.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // cover the notch/home-bar so env(safe-area-inset-*) works (bottom nav padding)
  viewportFit: "cover",
  themeColor: "#1a1917",
};

// Set the saved theme before paint so there's no light/dark flash on load.
// First launch = light (cream paper); dark stays a remembered choice.
const themeScript = `(function(){try{var t=localStorage.getItem('mb-theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVars} data-theme="light">
      <head>
        {/* preload the logo vectors so the boot logo is painted before it animates */}
        <link rel="preload" href="/mb-logotype.svg" as="image" type="image/svg+xml" />
        <link rel="preload" href="/mb-icon.svg" as="image" type="image/svg+xml" />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <PlayerLayer>{children}</PlayerLayer>
        <BottomNav />
        <SiteFX />
        <PremiumFX />
        <RegisterSW />
      </body>
    </html>
  );
}

import type { CSSProperties } from "react";

type LogoProps = {
  size?: number;
  className?: string;
  style?: CSSProperties;
};

export function TwitchLogo({ size = 16, className, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M2.149 0l-1.612 4.119v16.836h5.731v3.045h3.224l3.045-3.045h4.657l6.269-6.269v-14.686h-21.314zm19.164 13.612l-3.582 3.582h-5.731l-3.045 3.045v-3.045h-4.836v-15.045h17.194v11.463zm-3.582-7.343v6.262h-2.149v-6.262h2.149zm-5.731 0v6.262h-2.149v-6.262h2.149z" />
    </svg>
  );
}

export function KickLogo({ size = 16, className, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M1.333 0h6.667v5.333h2.667V2.667h2.666V0H20v8h-2.667v2.667h-2.666v2.666h2.666V16H20v8h-6.667v-2.667h-2.666V18.667H8V24H1.333z" />
    </svg>
  );
}

export function XLogo({ size = 16, className, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function InstagramLogo({ size = 16, className, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.2" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TikTokLogo({ size = 16, className, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z" />
    </svg>
  );
}

export function DiscordLogo({ size = 16, className, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056c2.053 1.508 4.041 2.423 5.993 3.03a.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.607 3.95-1.522 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export function GlobeLogo({ size = 16, className, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.2" />
      <path d="M2.8 12h18.4M12 2.8c2.7 2.9 2.7 15.5 0 18.4M12 2.8c-2.7 2.9-2.7 15.5 0 18.4" />
    </svg>
  );
}

// The social networks a member can link on their profile → their real logo.
export type SocialNet = "x" | "tiktok" | "instagram" | "discord" | "website";
export function SocialLogo({ net, size = 11, style }: { net: string; size?: number; style?: CSSProperties }) {
  if (net === "x") return <XLogo size={size} style={style} />;
  if (net === "tiktok") return <TikTokLogo size={size} style={style} />;
  if (net === "instagram") return <InstagramLogo size={size} style={style} />;
  if (net === "discord") return <DiscordLogo size={size} style={style} />;
  return <GlobeLogo size={size} style={style} />;
}

export type SourceKey = "twitch" | "kick" | "x";

export function SourceLogo({
  source,
  size = 16,
  style,
}: {
  source: SourceKey;
  size?: number;
  style?: CSSProperties;
}) {
  if (source === "twitch") return <TwitchLogo size={size} style={style} />;
  if (source === "kick") return <KickLogo size={size} style={style} />;
  return <XLogo size={size} style={style} />;
}

// Babel mark — stacked layers (a tower of voices unified into one).
export function BabelMark({ size = 22, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={style}
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="3.6" rx="1.8" />
      <rect x="6.5" y="10.2" width="11" height="3.6" rx="1.8" opacity="0.8" />
      <rect x="9" y="16.4" width="6" height="3.6" rx="1.8" opacity="0.6" />
    </svg>
  );
}

// Market Bubble wordmark mark — the angular bracket under the name from the brand.
export function MarketBubbleMark({ size = 18, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      <path d="M3 7 L12 16 L21 7" />
      <path d="M8 19 L12 15 L16 19" />
    </svg>
  );
}

export const SOURCE_LABELS: Record<SourceKey, string> = {
  twitch: "Twitch",
  kick: "Kick",
  x: "X",
};

export const SOURCE_COLORS: Record<SourceKey, string> = {
  twitch: "#9146FF",
  kick: "#53FC18",
  x: "#FFFFFF",
};

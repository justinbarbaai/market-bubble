"use client";

import { usePathname } from "next/navigation";
import { GrainOverlay } from "./GrainOverlay";
import { MagneticFX } from "./MagneticFX";
import { BootSequence } from "./BootSequence";

// Routes that must stay bare — OBS browser sources / embeds. No grain, no boot,
// no FX (those would paint a non-transparent layer over the chat overlay).
const BARE = ["/overlay"];

/**
 * Site-wide FX, mounted once in the root layout. Kept intentionally minimal —
 * the premium feel comes from restraint:
 *  - paper grain over everything
 *  - magnetic interactive elements (subtle pull toward the cursor)
 *  - cold-open boot sequence on every load
 * Skipped entirely on embed/overlay routes so they composite transparently.
 */
export function SiteFX() {
  const path = usePathname();
  if (path && BARE.some((p) => path.startsWith(p))) return null;
  return (
    <>
      <GrainOverlay />
      <MagneticFX />
      <BootSequence />
    </>
  );
}

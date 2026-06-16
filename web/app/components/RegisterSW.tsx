"use client";

import { useEffect } from "react";

// Registers the service worker (required for the install prompt + offline shell).
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}

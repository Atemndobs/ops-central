"use client";

import { useEffect } from "react";

/**
 * When the install page is opened as an ALREADY-INSTALLED app (standalone
 * display mode), forward to the dashboard. When viewed in a normal browser tab
 * (i.e. the user is about to install), do nothing so they can Add to Home Screen.
 */
export function StandaloneRedirect() {
  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari legacy flag
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      window.location.replace("/");
    }
  }, []);
  return null;
}

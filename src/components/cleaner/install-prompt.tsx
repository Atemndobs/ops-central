"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

const DISMISSED_KEY = "chezsoi-install-dismissed";

export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already installed or previously dismissed
    if (isInStandaloneMode()) return;
    if (sessionStorage.getItem(DISMISSED_KEY)) {
      setDismissed(true);
      return;
    }

    // iOS: show manual hint
    if (isIos()) {
      setShowIosHint(true);
      return;
    }

    // Android / desktop Chrome: listen for native prompt
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setShowIosHint(false);
    setPromptEvent(null);
  };

  // Already installed or dismissed
  if (dismissed) return null;

  // iOS banner — share sheet instructions
  if (showIosHint) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-[var(--foreground)]">Install ChezSoi App</p>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 text-lg leading-none text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
          Add to your home screen for one-tap launch, full screen, and offline access.
        </p>
        <div className="mt-2.5 flex items-center gap-2 rounded-md bg-[var(--muted)]/60 px-3 py-2 text-xs text-[var(--foreground)]">
          {/* Share icon */}
          <svg className="h-4 w-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span>
            Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>
          </span>
        </div>
      </div>
    );
  }

  // Android / desktop Chrome — native install prompt
  if (!promptEvent) return null;

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-[var(--foreground)]">Install ChezSoi App</p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-lg leading-none text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
        Install for faster launch, full screen, and offline access.
      </p>
      <button
        type="button"
        className="mt-2.5 w-full rounded-md bg-[var(--primary)] py-2 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 active:opacity-80"
        onClick={async () => {
          await promptEvent.prompt();
          await promptEvent.userChoice;
          setPromptEvent(null);
        }}
      >
        Install App
      </button>
    </div>
  );
}

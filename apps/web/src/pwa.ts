import { toastManager } from "./components/ui/toast";
import { isElectron } from "./env";
import { registerSW } from "virtual:pwa-register";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const IOS_INSTALL_HINT_STORAGE_KEY = "t3code.pwa.ios-install-hint-at";
const IOS_INSTALL_HINT_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 14;

let serviceWorkerRegistered = false;
let offlineReadyToastShown = false;
let updateToastShown = false;
let installPromptToastShown = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosBrowser(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function shouldShowIosInstallHint(): boolean {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return false;
  }
  if (!isIosBrowser() || isStandaloneDisplayMode()) {
    return false;
  }

  try {
    const rawValue = localStorage.getItem(IOS_INSTALL_HINT_STORAGE_KEY);
    const lastShownAt = rawValue ? Number.parseInt(rawValue, 10) : 0;
    return !Number.isFinite(lastShownAt) || Date.now() - lastShownAt >= IOS_INSTALL_HINT_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markIosInstallHintShown(): void {
  try {
    localStorage.setItem(IOS_INSTALL_HINT_STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore storage failures for install hint telemetry.
  }
}

function showIosInstallHint(): void {
  if (!shouldShowIosInstallHint()) {
    return;
  }

  markIosInstallHintShown();
  toastManager.add({
    type: "info",
    title: "Install on iPhone or iPad",
    description: "Use Safari's Share menu, then choose Add to Home Screen.",
    data: {
      dismissAfterVisibleMs: 9000,
    },
  });
}

function showInstallPromptToast(): void {
  if (!deferredInstallPrompt || installPromptToastShown || isStandaloneDisplayMode()) {
    return;
  }

  installPromptToastShown = true;
  toastManager.add({
    type: "info",
    title: "Install T3 Code",
    description: "Install the app for a more stable full-screen experience.",
    actionProps: {
      children: "Install",
      onClick: () => {
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        installPromptToastShown = false;
        if (!promptEvent) {
          return;
        }

        void promptEvent.prompt();
        void promptEvent.userChoice.finally(() => {
          deferredInstallPrompt = null;
        });
      },
    },
  });
}

export function registerAppServiceWorker(): void {
  if (
    serviceWorkerRegistered ||
    isElectron ||
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  serviceWorkerRegistered = true;

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (updateToastShown) {
        return;
      }

      updateToastShown = true;
      toastManager.add({
        type: "info",
        title: "Update available",
        description: "Reload to update the installed app shell.",
        actionProps: {
          children: "Reload",
          onClick: () => {
            void updateServiceWorker(true);
          },
        },
      });
    },
    onOfflineReady() {
      if (offlineReadyToastShown) {
        return;
      }

      offlineReadyToastShown = true;
      toastManager.add({
        type: "success",
        title: "Offline support ready",
        description: "The app shell is cached for faster relaunches and limited offline use.",
        data: {
          dismissAfterVisibleMs: 7000,
        },
      });
    },
    onRegisterError(error) {
      console.error("Failed to register the T3 Code service worker.", error);
    },
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    showInstallPromptToast();
  });

  window.addEventListener(
    "appinstalled",
    () => {
      deferredInstallPrompt = null;
      installPromptToastShown = false;
      toastManager.add({
        type: "success",
        title: "App installed",
        description: "T3 Code is now available from your home screen or app launcher.",
        data: {
          dismissAfterVisibleMs: 7000,
        },
      });
    },
    { once: true },
  );

  showIosInstallHint();
}

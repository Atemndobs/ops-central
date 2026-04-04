export type StoredWebPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

function getPublicKey(): string {
  return process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim() ?? "";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(normalized);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function hasWebPushPublicKey(): boolean {
  return getPublicKey().length > 0;
}

export async function getExistingWebPushSubscription(): Promise<StoredWebPushSubscription | null> {
  if (!isWebPushSupported()) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.toJSON() ?? null;
}

export async function ensureWebPushSubscription(): Promise<StoredWebPushSubscription | null> {
  if (!isWebPushSupported()) {
    throw new Error("Push notifications are not supported in this browser.");
  }

  const publicKey = getPublicKey();
  if (!publicKey) {
    throw new Error("Missing NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY.");
  }

  if (Notification.permission !== "granted") {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  return subscription.toJSON();
}

export async function requestWebPushPermission(): Promise<NotificationPermission> {
  if (!isWebPushSupported()) {
    return "denied";
  }

  return await Notification.requestPermission();
}

export async function disableWebPushSubscription(): Promise<boolean> {
  if (!isWebPushSupported()) {
    return false;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return false;
  }

  return await subscription.unsubscribe();
}

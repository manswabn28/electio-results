type EventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const measurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID;
let initialized = false;

export function initAnalytics(): void {
  if (!measurementId || initialized || typeof window === "undefined") return;
  initialized = true;

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    window.dataLayer?.push(arguments);
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);

  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    page_path: window.location.pathname + window.location.search,
    send_page_view: false
  });
}

export function trackPageView(title = document.title): void {
  if (!measurementId || !window.gtag) return;
  window.gtag("event", "page_view", {
    page_title: title,
    page_location: window.location.href,
    page_path: window.location.pathname + window.location.search
  });
}

export function trackEvent(eventName: string, params: EventParams = {}): void {
  if (!measurementId || !window.gtag) return;
  window.gtag("event", eventName, params);
}

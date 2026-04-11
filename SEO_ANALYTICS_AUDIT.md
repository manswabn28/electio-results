# SEO, Performance, and Analytics Audit

## Audit Findings

- Framework/build: React 18 SPA built with Vite and TypeScript.
- Routing: No client router is currently used. Render rewrites all paths to `index.html`, so dynamic routes are SPA-compatible but not server-rendered.
- Metadata before changes: Basic static title and description only.
- Analytics before changes: No GA4 or event tracking was present.
- Sitemap/robots before changes: No `robots.txt` or `sitemap.xml` in the frontend public assets.
- Canonical handling before changes: No canonical tag beyond browser URL.
- Structured data before changes: No JSON-LD.
- Data loading: Frontend uses TanStack Query. Backend fetches ECI HTML, parses with Cheerio, and caches responses.
- Performance strengths: Selected result cards refresh independently; ECI calls are backend-only; backend now supports cache, request queue, backoff, stale data, and blocked-page detection.
- Performance risks: First full candidate-index build can be slow because every constituency detail page must be fetched once. This is cached after build.
- Crawlability risk: Important dynamic constituency views are not currently real pre-rendered HTML pages. Search engines can crawl the SPA shell, but full dynamic indexing is weaker than server-side rendering or prerendering.

## Safe Fixes Applied

- Added richer static metadata in `apps/frontend/index.html`.
- Added runtime SPA metadata handling:
  - unique title based on selected constituency count
  - meta description
  - canonical URL
  - JSON-LD `WebSite`, `Organization`, and `WebPage`
- Added `robots.txt`.
- Added `sitemap.xml` with the main SPA entry points.
- Added GA4 loader using `VITE_GA4_MEASUREMENT_ID`.
- Added isolated event tracking utilities.
- Added SPA page-view tracking.
- Added event tracking for:
  - manual refresh
  - constituency selection changes
  - candidate watch add/remove
  - watch mode enter/exit
  - pin/unpin
  - share link
  - scroll depth
- Kept all SEO and analytics changes non-visual except metadata and analytics behavior.

## Event Tracking Map

| Event name | Trigger | Parameters |
| --- | --- | --- |
| `page_view` | App load / selected count metadata update | `page_title`, `page_location`, `page_path` |
| `constituency_selection_change` | Constituency selection changes | `selected_count` |
| `candidate_watch_add` | Candidate added to watchlist | `candidate_id`, `constituency_id`, `party` |
| `candidate_watch_remove` | Candidate removed from watchlist | `candidate_id` |
| `refresh_now` | Manual refresh button | `selected_count` |
| `watch_mode_enter` | Watch mode opened | `selected_count` |
| `watch_mode_exit` | Watch mode closed | `selected_count` |
| `constituency_pin_toggle` | Pin/unpin card | `constituency_id`, `pinned` |
| `share_view` | Share button clicked | `selected_count`, `filter`, `sort` |
| `scroll_depth` | User reaches 25/50/75/100 percent scroll depth | `percent` |

## GA4 Setup Instructions

Set this frontend environment variable before building/deploying:

```env
VITE_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
```

The user requirement named `GA4_MEASUREMENT_ID`; because Vite only exposes client-side env vars prefixed with `VITE_`, the production-safe frontend variable is `VITE_GA4_MEASUREMENT_ID`.

In Render, add this environment variable to the static frontend service:

```text
VITE_GA4_MEASUREMENT_ID=your GA4 measurement id
```

## Search Console Setup Instructions

1. Deploy the frontend.
2. Open Google Search Console.
3. Add the production domain as a property.
4. Verify ownership using DNS or HTML tag.
5. Submit:

```text
https://kerala-election.onrender.com/sitemap.xml
```

6. Use URL Inspection for:

```text
https://kerala-election.onrender.com/
https://kerala-election.onrender.com/results
https://kerala-election.onrender.com/constituencies
```

## Remaining Recommendations

- Add prerendering for the home page and high-value constituency pages if organic search traffic becomes important.
- Generate a dynamic sitemap from the live constituency list after Kerala 2026 URLs are final.
- Consider persistent storage such as Redis or a database for total views, candidate index, and backend snapshots across deploys/restarts.
- Consider a server-side snapshot endpoint for bots if Search Console reports poor rendered indexing.
- Add Open Graph image assets before public launch.
- Add route-level metadata if a router is introduced later.

## Risky Changes Intentionally Avoided

- No migration to Next.js/SSR was performed.
- No route structure changes were made.
- No UI redesign or layout changes were made for SEO/analytics.
- No live refresh behavior was changed.
- No scraping behavior was changed for SEO purposes.
- No forced dynamic route generation was added because it could conflict with the current SPA flow.

## Potential Impact on Existing UI/Functionality

The SEO and analytics changes are intended to be non-visual and non-breaking.

- Appearance impact: none expected.
- User-flow impact: none expected.
- Data refresh impact: none expected.
- API behavior impact: none expected.
- Tracking impact: GA4 events will only send if `VITE_GA4_MEASUREMENT_ID` is configured.
- Crawlability impact: improved via static metadata, canonical, robots, sitemap, and JSON-LD, but full dynamic route indexing still requires prerendering or SSR for best results.

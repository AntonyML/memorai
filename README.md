# memorai

Take connected Markdown notes, keep them offline in your browser, and optionally sync them to GitHub. Agents can organize the same notebook through the local workspace.

## Screenshot

| | | |
| --- | --- | --- |
| ![memorai 1](assets/memorai01.png) | ![memorai 2](assets/memorai02.png) | ![memorai 3](assets/memorai03.png) |
| ![memorai 4](assets/memorai04.png) | ![memorai 5](assets/memorai05.png) | ![memorai 6](assets/memorai06.png) |

## Features

- **Markdown editing** with live preview and formatting toolbar (bold, italic, headings, etc.)
- **Offline data** — RxDB with Dexie/IndexedDB persists notes, relationships and inserted images without a GitHub account; existing browser notes migrate automatically
- **Connected knowledge** — note kinds, explicit relationships, backlinks and a graph; agents use the local notes CLI with `AGENTS.md` and `AGENT_NOTES.md`
- **Notebook insights** — Chart.js shows note types, connection counts and isolated notes, with accessible counts in a table
- **Touch navigation** — Hammer.js swipes between notes in preview, following search/sort order; Previous/Next buttons provide the same navigation
- **13 themes** — Catppuccin (Latte, Frappé, Macchiato, Mocha), Ayu, Cyberpunk 2077, Dracula, GitHub, Gruvbox Material, Night Owl, Nord, One, Tokyo Night — each with dark & light variants; dark/light preference preserved when switching
- **GitHub Repo sync** — notes stored as `.md` files with YAML frontmatter
- **Tags** with autocomplete and inline search
- **PWA** — installable on desktop and mobile, works offline
- **Image support** — paste, drag & drop, durable local storage and optional GitHub upload
- **Syntax highlighting** — code blocks support all major languages via highlight.js, with optional line numbers and a copy button
- **URL hash routing** — share notes via link
- **Export** — individual notes as `.md` or full backup as JSON
- **Server config** — deploy with `config.json` for shared settings
- **277 Lucide icons** — embeddable inline via `:icon-name:` syntax
- **SEO** — Open Graph, Twitter Cards, JSON-LD, canonical URL

## Quick Start

1. Install [Bun](https://bun.sh/) **1.3.14 or newer**, then clone and start the development server:
   ```bash
   git clone git@github.com:mojoaar/memorai.git
   cd memorai
   bun install --frozen-lockfile
   bun run dev
   ```
2. Open `http://localhost:8080`
3. Start writing. **Saved offline · RxDB** confirms browser persistence. Notes and images survive reloads without configuring GitHub.
4. For optional sync, go to Settings → enter your GitHub token and repository

> **Token permissions:** create a [fine-grained personal access token](https://github.com/settings/tokens) with **Read and write** access to **Contents** — this is required for syncing notes, images, and deletions with your repository.

5. Click "Sync with Repo" to start syncing

IndexedDB data belongs to the browser profile and origin (including the port). Open the app online once so the service worker can cache its shell, then it can reload offline. The local agent workspace lives separately in `.memorai/workspace.json`; the source server reconciles it with browser notes. Static hosting uses browser storage and optional GitHub. JSON/Markdown exports include notes and connections; inserted image binaries remain in IndexedDB or the configured GitHub repository.

## Development & Deployment

| Command | Purpose |
| --- | --- |
| `bun install --frozen-lockfile` | Install the pinned dependencies |
| `bun run dev` | Build libraries and serve the source on port 8080; watch server code |
| `bun start` | Build libraries and serve the source without watching |
| `bun run vendor` | Regenerate the local browser dependency bundle |
| `bun run build` | Bundle libraries and copy public assets into `dist/` |
| `bun run preview` | Serve `dist/`; requires a completed build |
| `bun run notes -- help` | Show the local agent notebook commands |
| `bun test` | Check storage, migrations, reconciliation, sync, graph, HTTP and builds |

The frontend stays vanilla JavaScript. Bun bundles pinned dependencies into `assets/vendor.js` automatically before serving or building; app modules keep their existing IIFE structure. Deploy `dist/` to any static host; Bun is only needed for local tooling. The runtime does not fetch JavaScript libraries from a package CDN.

The server uses `PORT` and `HOST` environment variables. For example, in bash/zsh:

```bash
PORT=3000 bun run dev
HOST=0.0.0.0 bun run dev
```

In PowerShell, set the variable before starting the server:

```powershell
$env:PORT = '3000'
bun run dev
```

Set `HOST` to `0.0.0.0` explicitly to access the server from another device on your LAN.

## Configuration

Place a `config.json` at the web root for deployment-wide settings:

```json
{
  "githubToken": "ghp_xxx",
  "repo": "owner/repo-name",
  "branch": "main",
  "url": "https://notes.example.com",
  "title": "My Notes",
  "description": "Personal knowledge base"
}
```

All fields are optional. See `config.example.json` for details.

The source server serves an optional root `config.json`. Each build replaces `dist/` and excludes this config; copy it manually into `dist/` after building if the deployment needs shared settings. This JSON is visible to browser clients, including any token it contains.

## Tech Stack

- Bun for development, static serving, dependency bundling and tests
- Vanilla JavaScript (no framework; app scripts remain IIFEs)
- CSS custom properties for theming
- RxDB with free Dexie/IndexedDB storage, AJV schema validation and reactive multi-tab reconciliation
- Axios for GitHub and local workspace HTTP, Lodash for escaping, Luxon for local dates, Anime.js for motion-aware toasts
- Chart.js for notebook insights and Hammer.js for touch navigation in preview
- GitHub Contents API for optional sync
- Locally bundled `marked`, highlight.js and DOMPurify
- Service Worker for offline app assets

## Sponsor

If you find memorai useful, consider [buying me a coffee](https://buymeacoffee.com/mojoaar).

## Credits

Built with these excellent open-source libraries:

- [Axios](https://axios-http.com/) — HTTP client
- [RxDB](https://github.com/pubkey/rxdb) & [Dexie](https://dexie.org/) — reactive IndexedDB persistence
- [Lodash](https://lodash.com/) — utilities
- [Anime.js](https://animejs.com/) — animation
- [Chart.js](https://www.chartjs.org/) — charts
- [Luxon](https://moment.github.io/luxon/) — dates and time
- [Hammer.js](https://hammerjs.github.io/) — touch gestures
- [AJV](https://ajv.js.org/) — storage schema validation
- [marked](https://marked.js.org/) — Markdown parser
- [highlight.js](https://highlightjs.org/) — Syntax highlighting
- [DOMPurify](https://github.com/cure53/DOMPurify) — XSS sanitization
- [Lucide](https://lucide.dev/) — Icons (embedded SVG paths)
- [Inter](https://fonts.google.com/specimen/Inter) & [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — Fonts via Google Fonts

Theme credits:

- [Catppuccin](https://github.com/catppuccin/catppuccin) — Catppuccin community
- [Night Owl](https://github.com/sdras/night-owl-vscode-theme) — Sarah Drasner
- [Nord](https://www.nordtheme.com/) — Arctic Ice Studio
- [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme) — enkia
- [Dracula](https://draculatheme.com/) — Zeno Rocha
- [One Dark / One Light](https://github.com/atom/atom) — GitHub / Atom team
- [GitHub Dark / Light](https://github.com/primer/github-vscode-theme) — GitHub Primer team
- [Gruvbox Material](https://github.com/sainnhe/gruvbox-material) — sainnhe
- [Ayu](https://github.com/dempfi/ayu) — dempfi
- Cyberpunk 2077 — community-inspired palette

## License

MIT — see [LICENSE](LICENSE)

---

## Troubleshooting

### Browser not picking up a new version

If the app appears stuck on an old version, run this in the browser DevTools console to unregister its service worker and clear only its generated app caches, then reload while online:

```js
navigator.serviceWorker.getRegistrations()
  .then(regs => Promise.all(regs.map(r => r.unregister())))
  .then(() => caches.keys())
  .then(keys => Promise.all(keys.filter(k => k.startsWith('memorai-')).map(k => caches.delete(k))))
  .then(() => console.log('App cache refreshed — reload while online.'));
```

This keeps IndexedDB notes/images, localStorage preferences and fallback notes. Browser site-data deletion removes offline data; export notes and copy required images before clearing site data.

---

## Changelog

### 0.3.1

- Chart.js now powers Notebook insights with live counts and a note-type chart
- Hammer.js now powers touch swipes between preview notes, with search/sort awareness and Previous/Next buttons
- Each of the seven added libraries now supports an active application function

### 0.3.0

- Added the seven requested vanilla libraries with pinned versions and a local dependency bundle
- RxDB/Dexie persists notes, connections and inserted images offline, with legacy migration and concurrent tab reconciliation
- Kept GitHub sync and the agent workspace; Axios shares their HTTP error handling
- Local JavaScript assets are cached for offline reloads; IndexedDB failures retain recoverable data and show a save error

### 0.2.0

- Added the local agent notebook CLI, safe workspace bridge and two agent guides
- Added note kinds, explicit relationships, backlinks, wiki references and a connection map

### 0.1.9

- Sync now always pulls before pushing — the GitHub repo is the source of truth; this prevents notes created on other devices from being deleted during sync
- Silent background pull on app load when a repo is configured — no toast, no UI blocking
- Error toasts persist for 8 seconds (up from 3s) and include a copy button to capture the full error message
- Fixed sync push failures: remote SHAs fetched upfront to prevent "sha wasn't supplied" (422) and "does not match" (409) errors

### 0.1.8

- Fixed sync push failing with "sha wasn't supplied" when the repo contains notes not present in the local session — remote SHAs are now fetched upfront before pushing
- Fixed sync push failing with "does not match" conflict error — freshly fetched remote SHA now takes priority over stale locally-stored SHA
- Removed redundant API call during push: remote note listing is reused for both SHA resolution and deletion check
- Error toasts now persist for 8 seconds (up from 3s) and include a copy button to capture the full error message

### 0.1.7

- Added 4 new themes: Night Owl, Cyberpunk 2077, Gruvbox Material, Ayu — each with dark and light variants
- Theme dropdown simplified to one entry per family; switching themes preserves dark/light preference
- Theme list sorted alphabetically
- Default theme changed to Catppuccin Macchiato
- Settings: GitHub fields grouped in a dedicated card with inline connection validation
- Settings: custom chevron on theme/sort/display selects; danger zone uses flex column layout
- Expanded icon set to 277 Lucide icons (up from 228)

### 0.1.6

- Preview mode persists when switching between notes
- Fixed note reordering: notes no longer jump position when clicking between them — `updatedAt` and list order only change when content actually changes
- Fixed unsaved edits being discarded when switching notes quickly — pending save is now flushed for the previous note before switching context
- Auto-reload page when a new service worker takes control (ensures WebKit picks up updates without manual intervention)
- Service worker: `skipWaiting` + `clients.claim` for immediate activation on update
- Service worker: registered with `updateViaCache: 'none'` to bypass HTTP cache on update checks

### 0.1.5

- Copy button on code blocks in preview — appears on hover, copies raw code to clipboard
- Code line numbers setting — toggle on/off in Settings (off by default)
- Fixed syntax highlighting: migrated from deprecated `marked.setOptions({ highlight })` to `marked.use({ renderer: { code } })` for compatibility with marked v5+
- Unlanguaged code fences now fall back to `hljs.highlightAuto()` for best-effort highlighting

### 0.1.4

- Expanded icon set to 228 Lucide icons (up from 161)
- 20 coding & development icons: git-fork, git-merge, git-PR, bug, braces, server, terminal-square, etc.
- 49 new icons across emoji, data, weather, commerce, nature categories
- Credits section added to README

### 0.1.3

- Code snippet insertion with syntax highlighting via highlight.js
- Table insertion with GFM rendering and DOMPurify XSS protection
- Ordered list, unordered list, and task list insertion in formatting toolbar
- Horizontal rule, heading anchor (`{#id}`), and footnote (`[^1]`) insertion
- Tag chips redesigned with accent-filled background for better visibility
- Link, image, icon, code, and table buttons grouped together in formatting toolbar
- Toolbar tooltips on hover via `title` attributes
- Favicon 16px and 32px regenerated from SVG source
- 3 new Lucide icons added to embedded set (151 total)

### 0.1.2

- Sync now deletes remote notes removed locally (fix: orphaned `.md` files no longer left behind)
- Danger Zone in Settings — wipe all remote and local data with DELETE confirmation
- Hyperlink insertion button in formatting toolbar (`[text](url)`)
- Image and icon picker buttons moved from top toolbar to formatting toolbar
- Hide sync button and danger zone when no repository configured
- Favicon fixed for Safari/WebKit with proper link pattern (`favicon.ico` + PNGs)
- AGENTS.md added for AI-assisted development

### 0.1.1

- Removed Gist sync, replaced with GitHub Repo sync via Contents API
- Notes stored as `.md` files with YAML frontmatter — openable in any editor
- Images stored as separate files in repo instead of inline base64
- URL hash routing — share and bookmark individual notes
- Export single notes as `.md` with frontmatter
- Danger Zone: wipe all remote and local data with DELETE confirmation
- Server config via `config.json` with field locking and title/description override
- SEO: Open Graph, Twitter Cards, JSON-LD, canonical URL, `robots.txt`
- 3 new themes: Tokyo Night, Dracula, One Dark (12 total)
- Icon picker with 228 Lucide icons
- Browser favicon as inline data URI for WebKit compatibility
- Service worker with cache versioning, API filtering, and activate cleanup
- Bug fixes: XSS sanitization, localStorage error handling, auto-save sidebar update

### 0.1.0 — Initial Release

- Markdown editor with live preview and formatting toolbar
- 12 themes: Catppuccin, Nord, Tokyo Night, Dracula, One Dark, GitHub
- GitHub Repo sync via Contents API (notes as `.md`, images as files)
- Tags with autocomplete and search across title, content, and tags
- PWA support (offline cache, installable on desktop and mobile)
- Image paste, drag & drop, and upload with repo storage
- URL hash routing for sharing and bookmarking notes
- Export single notes as `.md` or full backup as JSON
- Server config via `config.json` with field locking
- 228 Lucide icons via inline embedded SVGs
- Icon picker with search
- Service worker with cache management and API filtering
- SEO: Open Graph, Twitter Cards, JSON-LD, canonical URL

# memorai

Cuaderno de notas Markdown con contextos, proyectos y skills conectados. Funciona offline y permite a agentes editar el cuaderno mediante un CLI local. GitHub es una sincronización opcional.

Agentes: [AGENTS.md](AGENTS.md) dirige a [promtInicial.md](promtInicial.md), el protocolo para recibir texto y convertirlo en notas sin modificar la app. Historial: [CAMBIOS.md](CAMBIOS.md).

## Ejecutar

Bun **>=1.3.14**. Desde la raíz:

```powershell
bun install --frozen-lockfile
bun run dev
```

Abre `http://localhost:8080`. `PORT` cambia el puerto; `HOST` vale `localhost` por defecto. `HOST=0.0.0.0` habilita acceso LAN y desactiva el puente para agentes.

| Comando | Resultado |
| --- | --- |
| `bun start` | Servidor sin watcher |
| `bun run notes -- help` | Operaciones del cuaderno; no requiere servidor |
| `bun run vendor` | Regenerar bibliotecas locales |
| `bun run build` | Bundle de dependencias y sitio estático en `dist/` |
| `bun run preview` | Servir un build existente |
| `bun test` | Pruebas de persistencia, grafos, sincronización e interfaz |

## Arquitectura

Frontend vanilla: módulos IIFE en `window.App`, estado mutable y DOM cacheado. `index.html` define el orden de carga. Bun empaqueta dependencias en `assets/vendor.js`; el navegador no depende de un CDN de JavaScript.

| Parte | Responsabilidad |
| --- | --- |
| `js/knowledge.js` | Formato compartido de notas, Markdown, relaciones y reconciliación |
| `js/offline.js` + `scripts/lib/offline-notebook.js` | RxDB/Dexie sobre IndexedDB, migración, notas e imágenes |
| `scripts/workspace.js` + `scripts/notes-cli.js` | Cuaderno de archivos, revisiones, bloqueo y reemplazo atómico |
| `js/workspace.js` + `scripts/server.js` | Puente entre navegador y agente |
| `js/connections.js` | Enlaces, backlinks y mapa SVG |
| `js/insights.js` / `js/gestures.js` | Estadísticas Chart.js / navegación táctil Hammer.js |
| `js/http.js` / `js/utils.js` | HTTP Axios / escape Lodash, fechas Luxon y avisos Anime.js |
| `js/sync.js` | GitHub Contents API; notas con frontmatter e imágenes separadas |

`marked`, highlight.js y DOMPurify renderizan Markdown con sanitización. Temas e iconos se mantienen en CSS y SVG locales.

## Datos y puente local

- Agente: `.memorai/workspace.json`, ignorado por Git y excluido del build, con respaldo `.bak`. Límite: 8 MiB y 5000 notas.
- Navegador: RxDB por origen/perfil; preferencias y respaldo auxiliar en localStorage. El grafo se confirma como un documento atómico; imágenes en otra colección. Las ediciones concurrentes conservan copias de conflicto.
- El servidor local reconcilia notas aproximadamente cada dos segundos mientras la app está visible. **Agent workspace connected** indica el puente; **Saved offline · RxDB** indica guardado del navegador.
- `GET /api/notes` devuelve `{version, revision, notes}`; PUT recibe `{revision, notes}`. Requiere loopback, JSON, Origin coincidente y revisión vigente; 409 exige releer.
- Preview/hosting estático no exponen ese puente. Los exports JSON/Markdown contienen notas y conexiones, sin binarios de imágenes. Para recargar offline, visita la app con conexión una vez; borrar los datos del sitio elimina la copia del navegador.

## GitHub y configuración

Configura token, repositorio y rama en Settings. El token necesita escritura en Contents; el sync primero descarga y después sube. Las notas pueden guardarse sin configurar GitHub.

`config.json` opcional fija los campos de [config.example.json](config.example.json). Se sirve al navegador, incluidos sus tokens; no es almacenamiento secreto. El build lo excluye y reemplaza `dist/`. Inclúyelo después del build únicamente si el despliegue lo necesita.

## Invariantes para desarrollo autorizado

- Mantén formato y reconciliación en `js/knowledge.js`; modifica notas mediante `App.updateNote`.
- Tras reemplazar HTML, llama a `App.refreshIcons`; usa DOMPurify al renderizar Markdown.
- Guarda preferencias con `App.saveSettings`; respeta campos bloqueados por configuración.
- Temas: `App.LIGHT_THEMES` y `App.themeToDropdownValue` son las referencias para modo y selector.
- Push GitHub: usa `remoteSHAs[note.id] || note._sha`.
- En cada release, sincroniza `App.VERSION` con el nombre de caché en `sw.js`. No caches API, configuración ni peticiones de GitHub.

MIT — [LICENSE](LICENSE). Proyecto original de Morten Johansen.

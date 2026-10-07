# Cambios de memorai

Historial de cambios; el funcionamiento actual está en [README.md](README.md).

## 0.3.3

- Modo pantalla completa en el mapa Connections (botón en toolbar y atajo Esc para salir); invalidación de caché del Service Worker.

## 0.3.2

- Borrado con confirmación visual asíncrona; modales comparten foco, teclado y cierre, sin apilarse.
- Settings accesible y limpieza remota cancelable; errores claros en toasts y estados, sin warnings de depuración.

## 2026-10-07 — documentación

- `promtInicial.md`: operación de notas como modo predeterminado; cambios del sistema solo con autorización explícita.
- `AGENTS.md`: entrada al protocolo y reglas compactas de exploración.
- `README.md`: referencia técnica breve; historial separado aquí.
- `AGENT_NOTES.md` eliminado: su contenido útil quedó integrado en `promtInicial.md`.

## 0.3.1

- Chart.js: estadísticas del cuaderno, tipos de notas y conexiones.
- Hammer.js: navegación táctil en preview, búsqueda/orden y botones anterior/siguiente.
- Protección de edición, selección, scroll y atajos detrás de diálogos.

## 0.3.0

- Axios, RxDB, Lodash, Anime.js, Chart.js, Luxon y Hammer.js con versiones fijadas y bundle local.
- Persistencia offline de notas, relaciones e imágenes; migración y reconciliación entre pestañas.
- GitHub y workspace conservados; errores de almacenamiento visibles y datos recuperables.

## 0.2.0

- CLI de notas, workspace privado y puente local con revisiones y bloqueo.
- Tipos de notas, relaciones explícitas, backlinks, referencias wiki y mapa.

## 0.1.9

- Sync descarga antes de subir; pull silencioso al arrancar.
- Errores con mayor duración y botón de copia; correcciones de conflictos SHA.

## 0.1.8

- SHA remoto actualizado evita errores 409/422; listado reutilizado para borrados.

## 0.1.7

- Más temas y selector simplificado; preferencia claro/oscuro conservada.
- Ajustes de GitHub agrupados y catálogo ampliado a 277 iconos.

## 0.1.6

- Preview conservado entre notas y texto pendiente guardado al cambiar.
- Orden estable y recarga automática al actualizar el service worker.

## 0.1.5

- Copia y números de línea en código; compatibilidad del renderer de Markdown.

## 0.1.4

- Catálogo ampliado a 228 iconos, incluidos desarrollo y datos.

## 0.1.3

- Tablas, listas, tareas, anclas y notas al pie; mejoras de etiquetas y barra de formato.

## 0.1.2

- Borrado de notas remotas y confirmación de limpieza.
- Mejoras de enlaces, imágenes, iconos y favicon.

## 0.1.1

- GitHub Contents API reemplaza Gist; notas Markdown con frontmatter e imágenes separadas.
- Rutas por hash, exportación, configuración de servidor, temas y mejoras PWA/SEO.

## 0.1.0

- Editor Markdown, preview, búsqueda, etiquetas, imágenes y temas.
- PWA offline, sincronización GitHub, exportación y configuración.

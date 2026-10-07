# memorai — entrada para agentes

Al iniciar trabajo en memorai, lee [promtInicial.md](promtInicial.md). El modo predeterminado es organizar notas usando la app y su CLI. Modificar el sistema requiere una petición explícita del usuario.

Para desarrollo autorizado, consulta [README.md](README.md). El historial vive en [CAMBIOS.md](CAMBIOS.md); cárgalo solo si necesitas antecedentes.

## CodeGraph — solo al investigar código

Antes de búsquedas amplias de arquitectura, llamadas, dependencias o impacto:

1. Resuelve la raíz con `git rev-parse --show-toplevel` (o el directorio actual), confirma que es un proyecto y comprueba `.codegraph/`.
2. Si falta y CodeGraph está disponible, ejecuta una vez `gentle-ai codegraph init --cwd <raíz>`, sin pedir confirmación.
3. Usa `codegraph_explore`; sin MCP, usa la CLI upstream: `status`, `query`, `explore`, `node`, `files`, `callers`, `callees`, `impact`, `affected`. Si falla o no cubre lo requerido, explica el motivo y realiza lecturas dirigidas.

El watcher sincroniza cambios; `codegraph sync` solo si está deshabilitado o persiste desactualización. No ejecutes `uninit`, `install`, `uninstall`, `upgrade`; `index` requiere recuperación explícita por corrupción. Cada worktree necesita índice propio y ubicación bajo el directorio del usuario, nunca temporal; no copies ni compartas índices.

# Connections

The native ES module owns the Connections modal. `../connections.js` remains the
classic bridge to `window.App` and owns the existing note metadata/link panel.
`mountConnections(dialog, { notes, getGraph, navigate })` returns `open(focus)`,
`update()` and `destroy()`. Destroy cancels layout, animation, observers and
listeners. Positions are session-only; changing the graph clears history.

## Layout and rendering

- Smart: undirected BFS distance rings, circular barycenter ordering, size-aware
  ring spacing and deterministic overlap removal. Stable roots and component
  packing also support All notes.
- Layered: directed semantic edges, temporary cycle reversal, layers, virtual
  vertices and barycenter sweeps. Actual link directions remain intact.
- Force: seeded Fruchterman–Reingold, fixed iteration/cooling budget and box
  separation. None of these heuristics promises the global minimum of crossings.
- All positions are card centers. The pure layout and geometry functions consume
  measured dimensions and never access the DOM. The renderer uses keyed SVG
  nodes, native markers, curved parallel edges and collision-checked labels.
- More than 200 real nodes use a module Worker importing the same engine. A new
  request terminates the previous worker; stale results never change the map.
  SVG is retained for the current small notebook. Consider Canvas only after a
  real graph exceeds about 500 nodes and profiling shows SVG is the bottleneck;
  Canvas would require accessible DOM controls and custom hit testing.

The entrypoint composes UI, state, rendering and interaction. Pure layout depends
only on domain data/geometry; rendering never imports UI. Theme tokens inherit
the app's `data-theme` variables, with graph-specific contrast-safe overrides.
System fonts avoid adding network resources. Only the modal can scroll; the graph
surface uses pan/zoom. Labels appear on hover/focus or above 120% zoom.
Resizing refits an automatically fitted map; a manually chosen camera is preserved.

## Try it

Open Connections, choose Show/Distance and use Auto Layout. Smart is the default;
Layered and Force provide alternative views. Drag the background to pan, drag a
card to reposition it, and use wheel/pinch or the zoom buttons. A click or Enter
opens a note; arrow keys follow neighboring nodes. `+`/`-` zoom and `0` fits.
Undo/Redo restore card positions and camera; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z work
within the modal, excluding editable controls. Reduced motion skips interpolation.

Run `node --test tests/connections/*.test.js`, `bun test` and `bun run build` from
the project root. Strict checking requires an existing TypeScript compiler:
`tsc --project js/connections/jsconfig.json --noEmit` and
`tsc --project js/connections/workers/jsconfig.json --noEmit`. No compiler is
added to project dependencies. Classic bridge/export scripts remain outside the
native module's checking scope.

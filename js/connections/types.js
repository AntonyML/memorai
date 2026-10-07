// @ts-check

/** @typedef {'part-of' | 'related' | 'depends-on'} LinkType */
/** @typedef {'note' | 'context' | 'project' | 'skill' | 'decision' | 'meeting' | 'reference'} NoteKind */
/** @typedef {'smart' | 'layered' | 'force'} LayoutMode */
/** @typedef {{x: number, y: number}} Point */
/** @typedef {{x: number, y: number, width: number, height: number}} Bounds */
/** @typedef {Record<string, Point>} Positions */
/** @typedef {{id: string, title: string, kind: NoteKind}} NoteSummary */
/** @typedef {NoteSummary & {width: number, height: number}} GraphNode */
/** @typedef {{id: string, source: string, target: string, type: LinkType, explicit: boolean}} GraphEdge */
/** @typedef {{nodes: GraphNode[], edges: GraphEdge[], focus: string | null}} Graph */
/** @typedef {{positions: Positions, bounds: Bounds}} LayoutResult */
/** @typedef {{edge: GraphEdge, path: string, label: Point, start: Point, end: Point}} EdgeRoute */
/** @typedef {{x: number, y: number, scale: number}} Camera */
/** @typedef {{positions: Positions, camera: Camera}} Snapshot */
/** @typedef {{notes: () => NoteSummary[], getGraph: (focus: string | null, depth: number) => unknown, navigate: (id: string) => void}} ConnectionsOptions */
/** @typedef {{open: (focus: string | null) => void, update: () => void, destroy: () => void}} ConnectionsController */

export {};

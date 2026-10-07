// @ts-check

/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').GraphNode} GraphNode */
/** @typedef {import('../types.js').Positions} Positions */
/** @typedef {import('../types.js').Point} Point */
/** @typedef {import('../types.js').Bounds} Bounds */

export const BOX_GAP = 28;
export const COMPONENT_GAP = 100;

/** @param {string} a @param {string} b */
export function compareId(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** Make the layout independent of transport/DOM ordering without changing its input.
 * @param {Graph} graph @returns {Graph}
 */
export function canonicalGraph(graph) {
    const nodes = graph.nodes.map(node => ({
        ...node,
        width: Number.isFinite(node.width) ? Math.max(1, node.width) : 180,
        height: Number.isFinite(node.height) ? Math.max(1, node.height) : 68
    })).sort((a, b) => compareId(a.id, b.id));
    const ids = new Set(nodes.map(node => node.id));
    const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))
        .slice().sort((a, b) => compareId(a.id, b.id)
            || compareId(a.source, b.source) || compareId(a.target, b.target)
            || compareId(a.type, b.type));
    return { nodes, edges, focus: graph.focus && ids.has(graph.focus) ? graph.focus : null };
}

/** @param {Graph} graph @returns {Map<string, string[]>} */
export function adjacency(graph) {
    const neighbors = new Map(graph.nodes.map(node => [node.id, new Set(/** @type {string[]} */ ([]))]));
    for (const edge of graph.edges) {
        if (edge.source === edge.target) continue;
        neighbors.get(edge.source)?.add(edge.target);
        neighbors.get(edge.target)?.add(edge.source);
    }
    return new Map(Array.from(neighbors, ([id, ids]) => [id, Array.from(ids).sort(compareId)]));
}

/** @param {Graph} graph @returns {Graph[]} */
export function components(graph) {
    const neighbors = adjacency(graph);
    const remaining = new Set(graph.nodes.map(node => node.id));
    /** @type {Graph[]} */
    const result = [];
    for (const node of graph.nodes) {
        if (!remaining.has(node.id)) continue;
        const queue = [node.id];
        remaining.delete(node.id);
        for (let index = 0; index < queue.length; index++) {
            for (const id of neighbors.get(queue[index]) || []) {
                if (!remaining.delete(id)) continue;
                queue.push(id);
            }
        }
        const ids = new Set(queue);
        result.push({
            nodes: graph.nodes.filter(item => ids.has(item.id)),
            edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)),
            focus: graph.focus && ids.has(graph.focus) ? graph.focus : null
        });
    }
    return result.sort((a, b) => Number(Boolean(b.focus)) - Number(Boolean(a.focus))
        || compareId(a.nodes[0].id, b.nodes[0].id));
}

/** @param {Graph} graph @returns {string} */
export function stableRoot(graph) {
    if (graph.focus) return graph.focus;
    const neighbors = adjacency(graph);
    const kindPriority = { context: 0, project: 1, note: 2, skill: 2, decision: 2, meeting: 2, reference: 2 };
    return graph.nodes.slice().sort((a, b) => kindPriority[a.kind] - kindPriority[b.kind]
        || (neighbors.get(b.id)?.length || 0) - (neighbors.get(a.id)?.length || 0)
        || compareId(a.id, b.id))[0].id;
}

/** @param {Graph} graph @param {Positions} positions @returns {Bounds} */
export function componentBounds(graph, positions) {
    if (!graph.nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of graph.nodes) {
        const point = positions[node.id];
        left = Math.min(left, point.x - node.width / 2);
        right = Math.max(right, point.x + node.width / 2);
        top = Math.min(top, point.y - node.height / 2);
        bottom = Math.max(bottom, point.y + node.height / 2);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** @param {GraphNode} a @param {Point} pa @param {GraphNode} b @param {Point} pb @param {number} [gap] */
export function boxesOverlap(a, pa, b, pb, gap = 0) {
    return Math.abs(pa.x - pb.x) < (a.width + b.width) / 2 + gap - 1e-7
        && Math.abs(pa.y - pb.y) < (a.height + b.height) / 2 + gap - 1e-7;
}

/** A finite, monotonic final pass makes overlap freedom an invariant, not a
 * convergence assumption. Positions are centers. Existing valid layouts stay put.
 * @param {Graph} graph @param {Positions} positions @returns {Positions}
 */
export function clearOverlaps(graph, positions) {
    /** @type {Positions} */
    const result = {};
    const nodes = graph.nodes.slice().sort((a, b) => positions[a.id].x - positions[b.id].x
        || positions[a.id].y - positions[b.id].y || compareId(a.id, b.id));
    /** @type {GraphNode[]} */
    const placed = [];
    for (const node of nodes) {
        const point = { ...positions[node.id] };
        // Moving only right crosses each conflicting interval at most once.
        let changed = true;
        while (changed) {
            changed = false;
            for (const other of placed) {
                if (!boxesOverlap(node, point, other, result[other.id], BOX_GAP)) continue;
                point.x = result[other.id].x + (node.width + other.width) / 2 + BOX_GAP;
                changed = true;
            }
        }
        result[node.id] = point;
        placed.push(node);
    }
    return result;
}

/** Pack connected components in deterministic shelves with padding.
 * @param {{graph: Graph, positions: Positions}[]} items @returns {Positions}
 */
export function packComponents(items) {
    if (!items.length) return {};
    if (items.length === 1) return items[0].positions;
    const boxes = items.map(item => componentBounds(item.graph, item.positions));
    const area = boxes.reduce((sum, box) => sum + (box.width + COMPONENT_GAP) * (box.height + COMPONENT_GAP), 0);
    const rowLimit = Math.max(Math.sqrt(area) * 1.35, ...boxes.map(box => box.width));
    /** @type {Positions} */
    const result = {};
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (let i = 0; i < items.length; i++) {
        const box = boxes[i];
        if (x > 0 && x + box.width > rowLimit) {
            x = 0;
            y += rowHeight + COMPONENT_GAP;
            rowHeight = 0;
        }
        for (const node of items[i].graph.nodes) {
            const point = items[i].positions[node.id];
            result[node.id] = { x: point.x - box.x + x, y: point.y - box.y + y };
        }
        x += box.width + COMPONENT_GAP;
        rowHeight = Math.max(rowHeight, box.height);
    }
    return result;
}

/** @param {Point} a @param {Point} b @param {Point} c */
function orientation(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

/** Strict intersections only; sharing a vertex is not a crossing.
 * @param {Graph} graph @param {Positions} positions @returns {number}
 */
export function crossingCount(graph, positions) {
    let count = 0;
    for (let i = 0; i < graph.edges.length; i++) {
        const a = graph.edges[i];
        if (a.source === a.target) continue;
        for (let j = i + 1; j < graph.edges.length; j++) {
            const b = graph.edges[j];
            if (b.source === b.target || a.source === b.source || a.source === b.target
                || a.target === b.source || a.target === b.target) continue;
            const pa = positions[a.source];
            const qa = positions[a.target];
            const pb = positions[b.source];
            const qb = positions[b.target];
            if (orientation(pa, qa, pb) * orientation(pa, qa, qb) < -1e-7
                && orientation(pb, qb, pa) * orientation(pb, qb, qa) < -1e-7) count++;
        }
    }
    return count;
}

/** @param {Graph} graph @param {Positions} positions */
export function totalEdgeLength(graph, positions) {
    return graph.edges.reduce((sum, edge) => sum + Math.hypot(
        positions[edge.source].x - positions[edge.target].x,
        positions[edge.source].y - positions[edge.target].y
    ), 0);
}

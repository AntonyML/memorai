// @ts-check

import { BOX_GAP, clearOverlaps, compareId } from './shared.js';

/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').Positions} Positions */
/** @typedef {{id: string, source: string, target: string}} InternalEdge */
/** @typedef {{id: string, width: number, height: number, real: boolean}} Vertex */

/** Break cycles only in the layout's private graph. The original edge direction
 * remains untouched for routing, labels, and persistence.
 * @param {Graph} graph @returns {InternalEdge[]}
 */
function acyclicEdges(graph) {
    const edges = graph.edges.filter(edge => edge.type !== 'related' && edge.source !== edge.target);
    const outgoing = new Map(graph.nodes.map(node => [node.id, edges.filter(edge => edge.source === node.id)]));
    const state = new Map(graph.nodes.map(node => [node.id, 0]));
    /** @type {InternalEdge[]} */
    const result = [];
    // Iterative DFS also handles deep imported hierarchies without stack limits.
    for (const node of graph.nodes) {
        if (state.get(node.id)) continue;
        const stack = [{ id: node.id, index: 0 }];
        state.set(node.id, 1);
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const edge = (outgoing.get(frame.id) || [])[frame.index++];
            if (!edge) {
                state.set(frame.id, 2);
                stack.pop();
                continue;
            }
            if (state.get(edge.target) === 1) {
                result.push({ id: edge.id, source: edge.target, target: edge.source });
            } else {
                result.push({ id: edge.id, source: edge.source, target: edge.target });
                if (!state.get(edge.target)) {
                    state.set(edge.target, 1);
                    stack.push({ id: edge.target, index: 0 });
                }
            }
        }
    }
    return result.sort((a, b) => compareId(a.id, b.id));
}

/** @param {string[][]} layers @param {InternalEdge[]} segments */
function layerCrossings(layers, segments) {
    /** @type {Map<string, number>} */
    const rank = new Map();
    /** @type {Map<string, number>} */
    const order = new Map();
    for (let level = 0; level < layers.length; level++) {
        layers[level].forEach((id, index) => { rank.set(id, level); order.set(id, index); });
    }
    const byRank = layers.map((_, level) => segments.filter(edge => rank.get(edge.source) === level));
    let count = 0;
    for (const edges of byRank) {
        for (let i = 0; i < edges.length; i++) {
            for (let j = i + 1; j < edges.length; j++) {
                const a = edges[i];
                const b = edges[j];
                if (a.source === b.source || a.target === b.target) continue;
                if (((order.get(a.source) || 0) - (order.get(b.source) || 0))
                    * ((order.get(a.target) || 0) - (order.get(b.target) || 0)) < 0) count++;
            }
        }
    }
    return count;
}

/** Sugiyama-style pipeline: deterministic DFS, longest-path ranks, virtual
 * vertices for long edges, bounded barycenter sweeps, measured card placement.
 * @param {Graph} graph @returns {Positions}
 */
export function layeredLayout(graph) {
    if (!graph.nodes.length) return {};
    const edges = acyclicEdges(graph);
    const rank = new Map(graph.nodes.map(node => [node.id, 0]));
    const indegree = new Map(graph.nodes.map(node => [node.id, 0]));
    const outgoing = new Map(graph.nodes.map(node => [node.id, edges.filter(edge => edge.source === node.id)]));
    for (const edge of edges) indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    const queue = graph.nodes.filter(node => !indegree.get(node.id)).map(node => node.id).sort(compareId);
    while (queue.length) {
        const id = /** @type {string} */ (queue.shift());
        for (const edge of outgoing.get(id) || []) {
            rank.set(edge.target, Math.max(rank.get(edge.target) || 0, (rank.get(id) || 0) + 1));
            const degree = (indegree.get(edge.target) || 0) - 1;
            indegree.set(edge.target, degree);
            if (!degree) { queue.push(edge.target); queue.sort(compareId); }
        }
    }
    /** @type {Map<string, Vertex>} */
    const vertices = new Map(graph.nodes.map(node => [node.id, {
        id: node.id, width: node.width, height: node.height, real: true
    }]));
    /** @type {string[][]} */
    let layers = [];
    for (const node of graph.nodes) (layers[rank.get(node.id) || 0] ||= []).push(node.id);
    /** @type {InternalEdge[]} */
    const segments = [];
    for (const edge of edges) {
        const sourceRank = rank.get(edge.source) || 0;
        const targetRank = rank.get(edge.target) || 0;
        let previous = edge.source;
        for (let level = sourceRank + 1; level < targetRank; level++) {
            // Prefix and edge ID preserve reproducibility; collision suffix handles
            // arbitrary imported IDs without losing a real node.
            let id = `\u0000virtual:${edge.id}:${level}`;
            while (vertices.has(id)) id += ':';
            vertices.set(id, { id, width: 16, height: 1, real: false });
            rank.set(id, level);
            (layers[level] ||= []).push(id);
            segments.push({ id: `${edge.id}:${level}`, source: previous, target: id });
            previous = id;
        }
        segments.push({ id: `${edge.id}:end`, source: previous, target: edge.target });
    }
    layers = Array.from({ length: layers.length }, (_, level) => (layers[level] || []).sort(compareId));
    let best = layers.map(layer => layer.slice());
    let bestCrossings = layerCrossings(layers, segments);
    const incoming = new Map(Array.from(vertices.keys(), id => [id, segments.filter(edge => edge.target === id).map(edge => edge.source)]));
    const following = new Map(Array.from(vertices.keys(), id => [id, segments.filter(edge => edge.source === id).map(edge => edge.target)]));
    for (let pass = 0; pass < 12; pass++) {
        const levels = Array.from({ length: layers.length }, (_, level) => level);
        if (pass % 2) levels.reverse();
        for (const level of levels) {
            const adjacent = pass % 2 ? following : incoming;
            const positions = new Map(layers.flatMap(layer => layer.map((id, index) => [id, index])));
            const previous = new Map(layers[level].map((id, index) => [id, index]));
            /** @type {Map<string, number>} */
            const barycenters = new Map();
            for (const id of layers[level]) {
                const neighbors = adjacent.get(id) || [];
                barycenters.set(id, neighbors.length
                    ? neighbors.reduce((sum, other) => sum + (positions.get(other) || 0), 0) / neighbors.length
                    : previous.get(id) || 0);
            }
            layers[level].sort((a, b) => (barycenters.get(a) || 0) - (barycenters.get(b) || 0)
                || (previous.get(a) || 0) - (previous.get(b) || 0) || compareId(a, b));
        }
        const crossings = layerCrossings(layers, segments);
        if (crossings < bestCrossings) {
            bestCrossings = crossings;
            best = layers.map(layer => layer.slice());
        }
    }
    layers = best;
    /** @type {Positions} */
    const result = {};
    let previousHeight = 0;
    let y = 0;
    for (let level = 0; level < layers.length; level++) {
        const layer = layers[level];
        const height = Math.max(1, ...layer.map(id => vertices.get(id)?.height || 1));
        if (level) y += previousHeight / 2 + height / 2 + 90;
        const width = layer.reduce((sum, id) => sum + (vertices.get(id)?.width || 0), 0) + Math.max(0, layer.length - 1) * BOX_GAP;
        let x = -width / 2;
        for (const id of layer) {
            const vertex = /** @type {Vertex} */ (vertices.get(id));
            if (vertex.real) result[id] = { x: x + vertex.width / 2, y };
            x += vertex.width + BOX_GAP;
        }
        previousHeight = height;
    }
    return clearOverlaps(graph, result);
}

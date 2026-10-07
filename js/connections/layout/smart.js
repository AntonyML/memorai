// @ts-check

import { adjacency, BOX_GAP, clearOverlaps, compareId, crossingCount, stableRoot, totalEdgeLength } from './shared.js';

/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').GraphNode} GraphNode */
/** @typedef {import('../types.js').Positions} Positions */

const TAU = Math.PI * 2;
const SEAM = -Math.PI / 2;

/** @param {number} angle */
function normalizedAngle(angle) { return ((angle - SEAM) % TAU + TAU) % TAU; }

/** @param {string[][]} rings @param {number[]} radii @param {number[]} rotations @returns {Positions} */
function placeRings(rings, radii, rotations) {
    /** @type {Positions} */
    const positions = {};
    for (let depth = 0; depth < rings.length; depth++) {
        for (let index = 0; index < rings[depth].length; index++) {
            const angle = SEAM + rotations[depth] + TAU * index / rings[depth].length;
            positions[rings[depth][index]] = radii[depth] === 0 ? { x: 0, y: 0 } : {
                x: radii[depth] * Math.cos(angle),
                y: radii[depth] * Math.sin(angle)
            };
        }
    }
    return positions;
}

/** Breadth-first distance is the radial level. Bounding circles make both
 * inter-ring and same-ring separation safe for measured rectangular labels.
 * @param {Graph} graph @returns {Positions}
 */
export function smartLayout(graph) {
    if (!graph.nodes.length) return {};
    const root = stableRoot(graph);
    const neighbors = adjacency(graph);
    const depth = new Map([[root, 0]]);
    const queue = [root];
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        for (const id of neighbors.get(current) || []) {
            if (depth.has(id)) continue;
            depth.set(id, (depth.get(current) || 0) + 1);
            queue.push(id);
        }
    }
    /** @type {string[][]} */
    let rings = [];
    for (const node of graph.nodes) {
        const level = depth.get(node.id) || 0;
        (rings[level] ||= []).push(node.id);
    }
    for (const ring of rings) ring.sort(compareId);
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const halfDiagonals = rings.map(ring => Math.max(...ring.map(id => {
        const node = /** @type {GraphNode} */ (nodeById.get(id));
        return Math.hypot(node.width, node.height) / 2;
    })));
    const radii = [0];
    for (let level = 1; level < rings.length; level++) {
        const radialGap = radii[level - 1] + halfDiagonals[level - 1] + halfDiagonals[level] + BOX_GAP * 2;
        const chordGap = rings[level].length > 1
            ? (halfDiagonals[level] * 2 + BOX_GAP * 2) / (2 * Math.sin(Math.PI / rings[level].length))
            : 0;
        radii.push(Math.max(radialGap, chordGap));
    }
    let rotations = rings.map(() => 0);
    let positions = placeRings(rings, radii, rotations);
    let bestRings = rings.map(ring => ring.slice());
    let bestRotations = rotations.slice();
    let bestCrossings = crossingCount(graph, positions);
    let bestLength = totalEdgeLength(graph, positions);

    // Alternate sweeps. Circular means respect the 0/2π seam; stable ties
    // retain the previous order, and only the best measured result is returned.
    for (let pass = 0; pass < 10; pass++) {
        const levels = Array.from({ length: Math.max(0, rings.length - 1) }, (_, index) => index + 1);
        if (pass % 2) levels.reverse();
        for (const level of levels) {
            const previousOrder = new Map(rings[level].map((id, index) => [id, index]));
            /** @type {Map<string, number>} */
            const barycenters = new Map();
            for (const id of rings[level]) {
                let sx = 0;
                let sy = 0;
                for (const other of neighbors.get(id) || []) {
                    if (other === root) continue;
                    const otherLevel = depth.get(other) || 0;
                    if (pass % 2 === 0 && otherLevel > level) continue;
                    if (pass % 2 === 1 && otherLevel < level) continue;
                    const point = positions[other];
                    const distance = Math.hypot(point.x, point.y);
                    if (!distance) continue;
                    sx += point.x / distance;
                    sy += point.y / distance;
                }
                const point = positions[id];
                barycenters.set(id, Math.hypot(sx, sy) > 1e-8
                    ? Math.atan2(sy, sx) : Math.atan2(point.y, point.x));
            }
            rings[level].sort((a, b) => normalizedAngle(barycenters.get(a) || 0) - normalizedAngle(barycenters.get(b) || 0)
                || (previousOrder.get(a) || 0) - (previousOrder.get(b) || 0) || compareId(a, b));
            let sx = 0;
            let sy = 0;
            for (let index = 0; index < rings[level].length; index++) {
                const target = barycenters.get(rings[level][index]) || 0;
                const initial = SEAM + TAU * index / rings[level].length;
                sx += Math.cos(target - initial);
                sy += Math.sin(target - initial);
            }
            rotations[level] = Math.hypot(sx, sy) > 1e-8 ? Math.atan2(sy, sx) : rotations[level];
            positions = placeRings(rings, radii, rotations);
        }
        const crossings = crossingCount(graph, positions);
        const length = totalEdgeLength(graph, positions);
        if (crossings < bestCrossings || (crossings === bestCrossings && length < bestLength - 1e-6)) {
            bestCrossings = crossings;
            bestLength = length;
            bestRings = rings.map(ring => ring.slice());
            bestRotations = rotations.slice();
        }
    }
    rings = bestRings;
    rotations = bestRotations;
    return clearOverlaps(graph, placeRings(rings, radii, rotations));
}

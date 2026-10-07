// @ts-check

import { adjacency, BOX_GAP, boxesOverlap, clearOverlaps, compareId, crossingCount, edgeNodeIncidenceCount, stableRoot, totalEdgeLength } from './shared.js';

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

/** Barycenters alone can leave same-ring chords trapped in a poor circular order.
 * For small graphs, relax individual angles and score crossings/card obstructions.
 * A fixed evaluation budget keeps Worker/fallback results identical and bounded.
 * @param {Graph} graph @param {string[][]} initialRings @param {number[]} radii
 * @param {number[]} initialRotations @returns {Positions}
 */
function refineSmallGraph(graph, initialRings, radii, initialRotations) {
    let best = placeRings(initialRings, radii, initialRotations);
    let bestCrossings = crossingCount(graph, best);
    let bestObstructions = edgeNodeIncidenceCount(graph, best);
    let bestLength = totalEdgeLength(graph, best);
    if (graph.nodes.length > 20 || graph.edges.length > 64 || initialRings.length < 2) return best;
    const movable = initialRings.slice(1).flat();
    const levels = movable.map(id => initialRings.findIndex(ring => ring.includes(id)));
    const baseAngles = movable.map(id => Math.atan2(best[id].y, best[id].x));
    const root = initialRings[0][0];
    let state = 0x6d656d6f;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    /** @param {number[]} angles @param {number} scale @returns {Positions} */
    function placeAngles(angles, scale) {
        /** @type {Positions} */
        const positions = { [root]: { x: 0, y: 0 } };
        for (let index = 0; index < movable.length; index++) {
            const radius = radii[levels[index]] * scale;
            positions[movable[index]] = { x: Math.cos(angles[index]) * radius, y: Math.sin(angles[index]) * radius };
        }
        return positions;
    }
    /** @param {Positions} positions */
    function separated(positions) {
        for (let i = 0; i < graph.nodes.length; i++) {
            for (let j = i + 1; j < graph.nodes.length; j++) {
                if (boxesOverlap(graph.nodes[i], positions[graph.nodes[i].id], graph.nodes[j], positions[graph.nodes[j].id], BOX_GAP)) return false;
            }
        }
        return true;
    }
    const lengthScale = Math.max(1, bestLength);
    const iterations = graph.nodes.length > 12 ? 600 : 1200;
    // Fixed-seed angular search can leave a local crossing minimum without
    // changing BFS distance. Extra ring space permits nonuniform card angles.
    // Passing through another card is penalized as well as crossing another edge.
    for (const scale of [1, 1.25, 1.6]) {
        let angles = baseAngles.slice();
        const positions = placeAngles(angles, scale);
        const crossings = crossingCount(graph, positions);
        const obstructions = edgeNodeIncidenceCount(graph, positions);
        const length = totalEdgeLength(graph, positions);
        let energy = crossings + obstructions * 3 + length / lengthScale * 0.1;
        for (let iteration = 0; iteration < iterations; iteration++) {
            const candidate = angles.slice();
            const index = Math.floor(random() * movable.length);
            const operation = random();
            if (operation < 0.2) {
                const other = Math.floor(random() * movable.length);
                if (levels[index] !== levels[other] || index === other) continue;
                [candidate[index], candidate[other]] = [candidate[other], candidate[index]];
            } else if (operation < 0.28) {
                const pivot = random() * TAU;
                candidate.forEach((angle, i) => { if (levels[i] === levels[index]) candidate[i] = pivot - angle; });
            } else {
                const amplitude = 0.75 * (1 - iteration / iterations) + 0.05;
                candidate[index] += (random() * 2 - 1) * amplitude;
            }
            const next = placeAngles(candidate, scale);
            if (!separated(next)) continue;
            const nextCrossings = crossingCount(graph, next);
            const nextObstructions = edgeNodeIncidenceCount(graph, next);
            const nextLength = totalEdgeLength(graph, next);
            const nextEnergy = nextCrossings + nextObstructions * 3 + nextLength / lengthScale * 0.1;
            const bestScore = bestCrossings + bestObstructions * 3;
            const nextScore = nextCrossings + nextObstructions * 3;
            if (nextScore < bestScore || (nextScore === bestScore && nextLength < bestLength - 1e-6)) {
                best = next;
                bestCrossings = nextCrossings;
                bestObstructions = nextObstructions;
                bestLength = nextLength;
            }
            const temperature = 1.6 * Math.pow(0.012, iteration / (iterations - 1));
            if (nextEnergy <= energy || random() < Math.exp((energy - nextEnergy) / temperature)) {
                angles = candidate;
                energy = nextEnergy;
            }
        }
    }
    return best;
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
    return clearOverlaps(graph, refineSmallGraph(graph, rings, radii, rotations));
}

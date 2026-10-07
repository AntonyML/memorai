// @ts-check

import { clearOverlaps } from './shared.js';

/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').Positions} Positions */
/** @typedef {import('../types.js').Point} Point */

/** @param {number} seed */
function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** Fixed seed, fixed iteration budget, and canonical traversal make main-thread
 * and module-Worker results identical. Card collision cleanup follows FR.
 * @param {Graph} graph @returns {Positions}
 */
export function forceLayout(graph) {
    if (!graph.nodes.length) return {};
    const random = randomGenerator(0x6d656d6f);
    const area = Math.max(1, graph.nodes.reduce((sum, node) => sum + node.width * node.height * 6, 0));
    const side = Math.sqrt(area);
    const k = Math.sqrt(area / graph.nodes.length);
    /** @type {Positions} */
    const positions = {};
    for (const node of graph.nodes) positions[node.id] = { x: (random() - 0.5) * side, y: (random() - 0.5) * side };
    const iterations = graph.nodes.length > 500 ? 70 : 150;
    for (let iteration = 0; iteration < iterations; iteration++) {
        /** @type {Positions} */
        const displacement = {};
        for (const node of graph.nodes) displacement[node.id] = { x: 0, y: 0 };
        for (let i = 0; i < graph.nodes.length; i++) {
            const a = graph.nodes[i];
            for (let j = i + 1; j < graph.nodes.length; j++) {
                const b = graph.nodes[j];
                let dx = positions[a.id].x - positions[b.id].x;
                let dy = positions[a.id].y - positions[b.id].y;
                if (Math.hypot(dx, dy) < 1e-7) {
                    const angle = random() * Math.PI * 2;
                    dx = Math.cos(angle) * 0.01;
                    dy = Math.sin(angle) * 0.01;
                }
                const distance = Math.max(0.01, Math.hypot(dx, dy));
                const force = k * k / distance;
                const fx = dx / distance * force;
                const fy = dy / distance * force;
                displacement[a.id].x += fx;
                displacement[a.id].y += fy;
                displacement[b.id].x -= fx;
                displacement[b.id].y -= fy;
            }
        }
        for (const edge of graph.edges) {
            if (edge.source === edge.target) continue;
            const dx = positions[edge.source].x - positions[edge.target].x;
            const dy = positions[edge.source].y - positions[edge.target].y;
            const distance = Math.max(0.01, Math.hypot(dx, dy));
            const force = distance * distance / k;
            const fx = dx / distance * force;
            const fy = dy / distance * force;
            displacement[edge.source].x -= fx;
            displacement[edge.source].y -= fy;
            displacement[edge.target].x += fx;
            displacement[edge.target].y += fy;
        }
        const temperature = side * 0.09 * Math.pow(1 - iteration / iterations, 2);
        for (const node of graph.nodes) {
            const delta = displacement[node.id];
            // Weak centering keeps disconnected parts of dense components bounded.
            delta.x -= positions[node.id].x * 0.035;
            delta.y -= positions[node.id].y * 0.035;
            const distance = Math.hypot(delta.x, delta.y);
            if (distance > 1e-9) {
                positions[node.id].x += delta.x / distance * Math.min(distance, temperature);
                positions[node.id].y += delta.y / distance * Math.min(distance, temperature);
            }
        }
    }
    const result = clearOverlaps(graph, positions);
    const origin = graph.focus ? result[graph.focus] : { x: 0, y: 0 };
    const offset = { ...origin };
    for (const node of graph.nodes) {
        result[node.id].x -= offset.x;
        result[node.id].y -= offset.y;
    }
    return result;
}

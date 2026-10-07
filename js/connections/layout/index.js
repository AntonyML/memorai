// @ts-check

import { boundsFor } from './geometry.js';
import { canonicalGraph, components, packComponents } from './shared.js';
import { smartLayout } from './smart.js';
import { layeredLayout } from './layered.js';
import { forceLayout } from './force.js';

/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').LayoutMode} LayoutMode */
/** @typedef {import('../types.js').LayoutResult} LayoutResult */

/** Pure shared entry point: no DOM, clocks, unseeded randomness, or mutation.
 * Coordinates identify the centers of the measured node cards.
 * @param {Graph} graph @param {LayoutMode} [mode] @returns {LayoutResult}
 */
export function layoutGraph(graph, mode = 'smart') {
    const normalized = canonicalGraph(graph);
    const layout = mode === 'layered' ? layeredLayout : mode === 'force' ? forceLayout : smartLayout;
    const positions = packComponents(components(normalized).map(component => ({
        graph: component, positions: layout(component)
    })));
    return { positions, bounds: boundsFor(normalized, positions) };
}

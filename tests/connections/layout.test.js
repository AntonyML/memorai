// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../../js/connections/layout/index.js';
import { boxesOverlap, crossingCount, clearOverlaps, edgeNodeIncidenceCount } from '../../js/connections/layout/shared.js';

/** @typedef {import('../../js/connections/types.js').Graph} Graph */
/** @typedef {import('../../js/connections/types.js').GraphNode} GraphNode */
/** @typedef {import('../../js/connections/types.js').GraphEdge} GraphEdge */
/** @typedef {import('../../js/connections/types.js').Positions} Positions */
/** @typedef {import('../../js/connections/types.js').LayoutMode} LayoutMode */

/** @param {string} id @param {number} [width] @param {number} [height] @returns {GraphNode} */
function node(id, width = 160, height = 60) { return { id, title: id, kind: 'note', width, height }; }
/** @param {string} source @param {string} target @param {GraphEdge['type']} [type] @returns {GraphEdge} */
function edge(source, target, type = 'part-of') { return { id: `${source}>${target}:${type}`, source, target, type, explicit: true }; }
/** @param {Graph} graph @param {Positions} positions */
function assertNoOverlap(graph, positions) {
    assert.equal(Object.keys(positions).length, graph.nodes.length);
    for (const item of graph.nodes) {
        assert.ok(Number.isFinite(positions[item.id].x) && Number.isFinite(positions[item.id].y), `finite ${item.id}`);
    }
    for (let i = 0; i < graph.nodes.length; i++) {
        for (let j = i + 1; j < graph.nodes.length; j++) {
            const a = graph.nodes[i];
            const b = graph.nodes[j];
            assert.equal(boxesOverlap(a, positions[a.id], b, positions[b.id]), false, `${a.id} overlaps ${b.id}`);
        }
    }
}
/** @param {Positions} positions @param {string} a @param {string} b */
function distance(positions, a, b) { return Math.hypot(positions[a].x - positions[b].x, positions[a].y - positions[b].y); }

test('empty and singleton graphs give finite measured bounds', () => {
    assert.deepEqual(layoutGraph({ nodes: [], edges: [], focus: null }), {
        positions: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }
    });
    const result = layoutGraph({ nodes: [node('only', 240, 96)], edges: [], focus: 'only' });
    assert.deepEqual(result.positions.only, { x: 0, y: 0 });
    assert.deepEqual(result.bounds, { x: -120, y: -48, width: 240, height: 96 });
});

test('smart layout uses BFS rings and measured cards without overlap', () => {
    /** @type {Graph} */
    const graph = {
        nodes: [node('r', 330, 130), node('a', 220, 80), node('b', 280, 90), node('c', 120, 140), node('d', 370, 100), node('e', 210, 120)],
        edges: [edge('r', 'a'), edge('r', 'b'), edge('r', 'c'), edge('a', 'd'), edge('b', 'e'), edge('c', 'b', 'related')],
        focus: 'r'
    };
    const { positions } = layoutGraph(graph);
    assert.deepEqual(positions.r, { x: 0, y: 0 });
    const first = distance(positions, 'r', 'a');
    assert.ok(Math.abs(distance(positions, 'r', 'b') - first) < 1e-6);
    assert.ok(Math.abs(distance(positions, 'r', 'c') - first) < 1e-6);
    const second = distance(positions, 'r', 'd');
    assert.ok(Math.abs(distance(positions, 'r', 'e') - second) < 1e-6);
    assert.ok(second > first);
    assertNoOverlap(graph, positions);
});

test('every mode is deterministic across input permutations and preserves its input', () => {
    /** @type {Graph} */
    const graph = {
        nodes: [node('r', 240, 100), node('a'), node('b', 210, 80), node('c'), node('isolated', 300, 96)],
        edges: [edge('r', 'a'), edge('a', 'b'), edge('b', 'r', 'depends-on'), edge('b', 'c', 'related'), edge('r', 'r')],
        focus: null
    };
    const original = structuredClone(graph);
    const permutation = { ...graph, nodes: graph.nodes.slice().reverse(), edges: graph.edges.slice().reverse() };
    /** @type {LayoutMode[]} */
    const modes = ['smart', 'layered', 'force'];
    for (const mode of modes) {
        const first = layoutGraph(graph, mode);
        assert.deepEqual(layoutGraph(permutation, mode), first, mode);
        assert.deepEqual(layoutGraph(graph, mode), first, `${mode} repeat`);
        assertNoOverlap(graph, first.positions);
    }
    assert.deepEqual(graph, original);
});

test('layered layout handles directed cycles internally and excludes virtual nodes', () => {
    /** @type {Graph} */
    const graph = {
        nodes: [node('a', 280, 80), node('b'), node('c', 140, 120), node('d')],
        edges: [edge('a', 'b'), edge('b', 'c', 'depends-on'), edge('c', 'a'), edge('c', 'd'), edge('a', 'd'), edge('b', 'b')],
        focus: 'a'
    };
    const originalEdges = structuredClone(graph.edges);
    const result = layoutGraph(graph, 'layered');
    assert.deepEqual(graph.edges, originalEdges);
    assert.ok(result.positions.a.y < result.positions.b.y);
    assert.ok(result.positions.b.y < result.positions.c.y);
    assert.ok(result.positions.c.y < result.positions.d.y);
    assert.equal(Object.keys(result.positions).length, 4);
    assertNoOverlap(graph, result.positions);
});

test('barycenter sweeps improve a connected two-layer crossing example', () => {
    /** @type {Graph} */
    const graph = { nodes: ['a', 'b', 'y', 'z'].map(id => node(id)), edges: [edge('a', 'z'), edge('b', 'y'), edge('a', 'y')], focus: null };
    const baseline = { a: { x: -100, y: 0 }, b: { x: 100, y: 0 }, y: { x: -100, y: 200 }, z: { x: 100, y: 200 } };
    assert.equal(crossingCount(graph, baseline), 1);
    const result = layoutGraph(graph, 'layered');
    assert.equal(crossingCount(graph, result.positions), 0);
});

test('circular barycenters reduce crossings relative to stable alphabetical rings', () => {
    /** @type {Graph} */
    const graph = {
        nodes: ['r', 'a', 'b', 'c', 'w', 'x', 'y'].map(id => node(id)),
        edges: [edge('r', 'a'), edge('r', 'b'), edge('r', 'c'), edge('a', 'y'), edge('b', 'x'), edge('c', 'w')],
        focus: 'r'
    };
    const result = layoutGraph(graph, 'smart');
    /** @type {Positions} */
    const baseline = { r: { x: 0, y: 0 } };
    for (const ring of [['a', 'b', 'c'], ['w', 'x', 'y']]) {
        const radius = distance(result.positions, 'r', ring[0]);
        ring.forEach((id, index) => {
            const angle = -Math.PI / 2 + index * Math.PI * 2 / ring.length;
            baseline[id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        });
    }
    assert.ok(crossingCount(graph, baseline) > 0);
    assert.ok(crossingCount(graph, result.positions) < crossingCount(graph, baseline));
    assertNoOverlap(graph, result.positions);
});

test('disconnected components and isolated notes are packed with no inter-component overlaps', () => {
    /** @type {Graph} */
    const graph = {
        nodes: [node('a', 400, 80), node('b'), node('c', 190, 180), node('d', 250, 90), node('e', 320, 100), node('f', 100, 100)],
        edges: [edge('a', 'b'), edge('c', 'd'), edge('d', 'e')], focus: null
    };
    for (const mode of /** @type {LayoutMode[]} */ (['smart', 'layered', 'force'])) {
        const result = layoutGraph(graph, mode);
        assertNoOverlap(graph, result.positions);
        assert.ok(result.bounds.width > 0 && result.bounds.height > 0);
    }
});

test('finite collision cleanup guarantees separation for coincident heterogeneous boxes', () => {
    const nodes = Array.from({ length: 80 }, (_, i) => node(`n${i}`, 100 + i * 3, 40 + i % 7 * 15));
    /** @type {Graph} */
    const graph = { nodes, edges: [], focus: null };
    const positions = Object.fromEntries(nodes.map(item => [item.id, { x: 0, y: 0 }]));
    const result = clearOverlaps(graph, positions);
    assertNoOverlap(graph, result);
    assert.ok(Object.values(positions).every(point => point.x === 0 && point.y === 0));
});

test('force layout clears measured cards for a dense deterministic graph', () => {
    const nodes = Array.from({ length: 45 }, (_, i) => node(`n${String(i).padStart(2, '0')}`, 140 + i % 6 * 25, 50 + i % 5 * 15));
    /** @type {GraphEdge[]} */
    const edges = [];
    for (let i = 0; i < nodes.length; i++) {
        edges.push(edge(nodes[i].id, nodes[(i + 1) % nodes.length].id, 'related'));
        edges.push(edge(nodes[i].id, nodes[(i + 7) % nodes.length].id, 'depends-on'));
    }
    /** @type {Graph} */
    const graph = { nodes, edges, focus: nodes[0].id };
    const result = layoutGraph(graph, 'force');
    assert.deepEqual(result.positions[nodes[0].id], { x: 0, y: 0 });
    assertNoOverlap(graph, result.positions);
});

test('large radial star preserves every distance and separates all 501 real nodes', () => {
    const nodes = [node('root', 280, 110), ...Array.from({ length: 500 }, (_, i) => node(`leaf${i}`, 80 + i % 7 * 12, 40 + i % 3 * 8))];
    /** @type {Graph} */
    const graph = { nodes, edges: nodes.slice(1).map(item => edge('root', item.id)), focus: 'root' };
    const result = layoutGraph(graph, 'smart');
    const radius = distance(result.positions, 'root', nodes[1].id);
    for (const item of nodes.slice(1)) assert.ok(Math.abs(distance(result.positions, 'root', item.id) - radius) < 1e-6);
    assertNoOverlap(graph, result.positions);
});

test('real ten-note topology removes card obstructions while improving the first Smart ordering', () => {
    // Anonymized 10-node/21-edge focus topology; a=context, b=skills project,
    // c=web project, d=operating context, e=focus, f=reference, g=proposal,
    // h/i/j=skills. Dimensions retain the measured title/card variation.
    const widths = [256, 252, 256, 230, 256, 256, 252, 238, 234, 252];
    /** @type {Graph} */
    const graph = {
        nodes: 'abcdefghij'.split('').map((id, index) => node(id, widths[index], 96)),
        edges: [
            edge('d', 'a'), edge('d', 'f', 'related'), edge('f', 'a', 'related'),
            edge('e', 'd'), edge('e', 'f', 'related'), edge('b', 'd'), edge('b', 'f', 'related'),
            edge('c', 'd'), edge('c', 'e', 'related'), edge('c', 'f', 'related'),
            edge('h', 'b'), edge('h', 'e', 'related'), edge('j', 'b'), edge('j', 'f', 'related'),
            edge('i', 'b'), edge('i', 'e', 'related'), edge('g', 'd'), edge('g', 'b', 'related'),
            edge('g', 'c', 'related'), edge('g', 'e', 'related'), edge('g', 'f', 'related')
        ], focus: 'e'
    };
    const result = layoutGraph(graph, 'smart');
    assert.ok(crossingCount(graph, result.positions) <= 7, 'initial circular barycenter layout had 8 crossings');
    assert.equal(edgeNodeIncidenceCount(graph, result.positions), 0);
    assertNoOverlap(graph, result.positions);
    const first = distance(result.positions, 'e', 'c');
    for (const id of ['d', 'f', 'g', 'h', 'i']) assert.ok(Math.abs(distance(result.positions, 'e', id) - first) < 1e-6);
    const second = distance(result.positions, 'e', 'a');
    for (const id of ['b', 'j']) assert.ok(Math.abs(distance(result.positions, 'e', id) - second) < 1e-6);
    assert.ok(second > first);
    assert.deepEqual(layoutGraph({ ...graph, nodes: graph.nodes.slice().reverse(), edges: graph.edges.slice().reverse() }, 'smart'), result);

    /** @type {Positions} */
    const legacy = { e: { x: 116, y: 306 } };
    ['d', 'f', 'c', 'h', 'i', 'g'].forEach((id, index) => { legacy[id] = { x: 390, y: 24 + 564 * (index + 0.5) / 6 }; });
    ['a', 'b', 'j'].forEach((id, index) => { legacy[id] = { x: 664, y: 24 + 564 * (index + 0.5) / 3 }; });
    const legacyGraph = { ...graph, nodes: graph.nodes.map(item => ({ ...item, width: 184, height: 60 })) };
    assert.equal(crossingCount(legacyGraph, legacy), 4);
    assert.ok(edgeNodeIncidenceCount(legacyGraph, legacy) >= 10, 'column BFS can hide collisions behind its crossing metric');
    assert.ok(crossingCount(graph, result.positions) + 3 * edgeNodeIncidenceCount(graph, result.positions)
        < crossingCount(legacyGraph, legacy) + 3 * edgeNodeIncidenceCount(legacyGraph, legacy));
});

test('edge/card incidence metric counts collinear card passages and ignores endpoints', () => {
    /** @type {Graph} */
    const graph = { nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'c')], focus: null };
    const blocked = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, c: { x: 600, y: 0 } };
    assert.equal(crossingCount(graph, blocked), 0);
    assert.equal(edgeNodeIncidenceCount(graph, blocked), 1);
    assert.equal(edgeNodeIncidenceCount(graph, { ...blocked, b: { x: 300, y: 200 } }), 0);
});

// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsFor, roundedRectIntersection, routeEdges } from '../../js/connections/layout/geometry.js';

/** @typedef {import('../../js/connections/types.js').Graph} Graph */
/** @typedef {import('../../js/connections/types.js').GraphNode} GraphNode */
/** @typedef {import('../../js/connections/types.js').Point} Point */

/** @param {string} id @param {number} [width=200] @param {number} [height=96] @returns {GraphNode} */
function node(id, width = 200, height = 96) {
    return { id, title: id, kind: 'note', width, height };
}

/** The rounded rectangle's signed distance must be zero at an arrow endpoint.
 * @param {Point} point @param {Point} center @param {GraphNode} card
 * @param {number} [radius=12]
 */
function assertBoundary(point, center, card, radius = 12) {
    const r = Math.min(radius, card.width / 2, card.height / 2);
    const qx = Math.abs(point.x - center.x) - card.width / 2 + r;
    const qy = Math.abs(point.y - center.y) - card.height / 2 + r;
    const signedDistance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    assert.ok(Math.abs(signedDistance) < 1e-9, `Endpoint is ${signedDistance} pixels from its rounded boundary`);
}

test('bounds use the measured node boxes around center positions', () => {
    /** @type {Graph} */
    const graph = { nodes: [node('a', 120, 60), node('b', 200, 100)], edges: [], focus: 'a' };
    assert.deepEqual(boundsFor(graph, { a: { x: 100, y: 100 }, b: { x: 400, y: 250 } }),
        { x: 40, y: 70, width: 460, height: 230 });
    assert.deepEqual(boundsFor({ nodes: [], edges: [], focus: null }, {}), { x: 0, y: 0, width: 0, height: 0 });
});

test('intersections hit sides and exposed rounded corners on the outward ray', () => {
    const card = node('a');
    const center = { x: 30, y: -20 };
    for (let degree = 0; degree < 360; degree += 2) {
        const angle = degree * Math.PI / 180;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };
        const hit = roundedRectIntersection(center, card, { x: center.x + direction.x * 1000, y: center.y + direction.y * 1000 });
        assertBoundary(hit, center, card);
        assert.ok(Math.abs((hit.x - center.x) * direction.y - (hit.y - center.y) * direction.x) < 1e-9);
        assert.ok((hit.x - center.x) * direction.x + (hit.y - center.y) * direction.y > 0);
    }
    const square = node('square', 100, 100);
    const corner = roundedRectIntersection({ x: 0, y: 0 }, square, { x: 100, y: 100 });
    assert.ok(corner.x < 50 && corner.y < 50, 'A diagonal arrow must stop on the arc, before the square corner');
    assertBoundary(corner, { x: 0, y: 0 }, square);
    assert.deepEqual(roundedRectIntersection(center, card, center), { x: 130, y: -20 });
});

test('reciprocal and parallel routes have distinct stable curves and exact endpoints', () => {
    /** @type {Graph} */
    const graph = {
        nodes: [node('a'), node('b', 250, 100)], focus: 'a',
        edges: [
            { id: 'ab2', source: 'a', target: 'b', type: 'part-of', explicit: true },
            { id: 'ba', source: 'b', target: 'a', type: 'related', explicit: true },
            { id: 'ab1', source: 'a', target: 'b', type: 'depends-on', explicit: true }
        ]
    };
    const positions = { a: { x: 0, y: 0 }, b: { x: 460, y: 130 } };
    const routes = routeEdges(graph, positions);
    assert.equal(routes.length, 3);
    assert.equal(new Set(routes.map(route => route.path)).size, 3);
    assert.equal(new Set(routes.map(route => `${route.label.x},${route.label.y}`)).size, 3);
    for (const route of routes) {
        const source = graph.nodes.find(card => card.id === route.edge.source);
        const target = graph.nodes.find(card => card.id === route.edge.target);
        assert.ok(source && target);
        const from = route.edge.source === 'a' ? positions.a : positions.b;
        const to = route.edge.target === 'a' ? positions.a : positions.b;
        assertBoundary(route.start, from, source);
        assertBoundary(route.end, to, target);
        const numbers = route.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)?.map(Number);
        assert.ok(numbers && numbers.every(Number.isFinite));
        assert.deepEqual(numbers.slice(-2), [route.end.x, route.end.y]);
    }
    assert.deepEqual(routeEdges({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, positions), routes);
});

test('unobstructed labels are the true quadratic and cubic parameter midpoint', () => {
    /** @type {Graph} */
    const graph = { nodes: [node('a'), node('b')], focus: 'a', edges: [
        { id: 'ab', source: 'a', target: 'b', type: 'related', explicit: true },
        { id: 'self', source: 'a', target: 'a', type: 'related', explicit: true }
    ] };
    const positions = { a: { x: 0, y: 0 }, b: { x: 600, y: 0 } };
    for (const route of routeEdges(graph, positions)) {
        const numbers = route.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)?.map(Number);
        assert.ok(numbers);
        const cubic = route.path.includes(' C ');
        const midpoint = cubic ? {
            x: (numbers[0] + 3 * numbers[2] + 3 * numbers[4] + numbers[6]) / 8,
            y: (numbers[1] + 3 * numbers[3] + 3 * numbers[5] + numbers[7]) / 8
        } : {
            x: (numbers[0] + 2 * numbers[2] + numbers[4]) / 4,
            y: (numbers[1] + 2 * numbers[3] + numbers[5]) / 4
        };
        assert.ok(Math.hypot(route.label.x - midpoint.x, route.label.y - midpoint.y) < 1e-9);
        const from = route.edge.source === 'a' ? positions.a : positions.b;
        const to = route.edge.target === 'a' ? positions.a : positions.b;
        const target = graph.nodes.find(card => card.id === route.edge.target);
        assert.ok(target);
        assertBoundary(route.start, from, graph.nodes[0]);
        assertBoundary(route.end, to, target);
    }
});

test('labels avoid every measured node box while remaining on their curve', () => {
    /** @type {Graph} */
    const graph = { nodes: [node('a'), node('b'), node('obstacle', 160, 96)], focus: 'a', edges: [
        { id: 'ab', source: 'a', target: 'b', type: 'depends-on', explicit: true }
    ] };
    const positions = { a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, obstacle: { x: 300, y: 0 } };
    const [route] = routeEdges(graph, positions);
    assert.notEqual(route.label.x, 300);
    assert.equal(route.label.y, 0);
    assert.ok(route.label.x > route.start.x && route.label.x < route.end.x);
    for (const card of graph.nodes) {
        const center = card.id === 'a' ? positions.a : card.id === 'b' ? positions.b : positions.obstacle;
        assert.ok(Math.abs(route.label.x - center.x) > card.width / 2 + 6
            || Math.abs(route.label.y - center.y) > card.height / 2 + 6);
    }
});

test('crowded arcs and multiple self loops still produce clear finite routes', () => {
    /** @type {Graph} */
    const graph = { nodes: [node('a'), node('b'), node('wall', 500, 220)], focus: 'a', edges: [
        { id: 'ab', source: 'a', target: 'b', type: 'related', explicit: true },
        { id: 'self2', source: 'a', target: 'a', type: 'related', explicit: true },
        { id: 'self1', source: 'a', target: 'a', type: 'related', explicit: true }
    ] };
    const positions = { a: { x: 0, y: 0 }, b: { x: 420, y: 0 }, wall: { x: 210, y: 0 } };
    const routes = routeEdges(graph, positions);
    assert.equal(new Set(routes.map(route => route.path)).size, 3);
    for (const route of routes) {
        assert.ok(Number.isFinite(route.label.x) && Number.isFinite(route.label.y));
        for (const card of graph.nodes) {
            const center = card.id === 'a' ? positions.a : card.id === 'b' ? positions.b : positions.wall;
            assert.ok(Math.abs(route.label.x - center.x) > card.width / 2 + 6
                || Math.abs(route.label.y - center.y) > card.height / 2 + 6);
        }
    }
});

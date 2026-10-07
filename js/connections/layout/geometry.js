// @ts-check

/** @typedef {import('../types.js').Point} Point */
/** @typedef {import('../types.js').Bounds} Bounds */
/** @typedef {import('../types.js').Positions} Positions */
/** @typedef {import('../types.js').Graph} Graph */
/** @typedef {import('../types.js').GraphNode} GraphNode */
/** @typedef {import('../types.js').GraphEdge} GraphEdge */
/** @typedef {import('../types.js').EdgeRoute} EdgeRoute */
/** @typedef {{width: number, height: number}} Size */
/** @typedef {{start: Point, end: Point, control: Point, control2?: Point}} Curve */
/** @typedef {{point: Point, clear: boolean}} LabelCandidate */

const CARD_RADIUS = 12;
const LABEL_PADDING = 6;

/** @param {number} value @param {number} fallback */
function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

/** @param {Point | undefined} point @returns {Point} */
function safePoint(point) {
    return { x: finite(point?.x ?? 0, 0), y: finite(point?.y ?? 0, 0) };
}

/** @param {Size} size @returns {Size} */
function safeSize(size) {
    return {
        width: Math.max(1, finite(size.width, 1)),
        height: Math.max(1, finite(size.height, 1))
    };
}

/** @param {string} a @param {string} b */
function compare(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** @param {GraphEdge} a @param {GraphEdge} b */
function compareEdges(a, b) {
    return compare(a.source, b.source) || compare(a.target, b.target)
        || compare(a.id, b.id) || compare(a.type, b.type)
        || Number(a.explicit) - Number(b.explicit);
}

/** Node positions are centers; the returned bounds include measured card boxes.
 * @param {Graph} graph @param {Positions} positions @returns {Bounds}
 */
export function boundsFor(graph, positions) {
    if (!graph.nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of graph.nodes) {
        const center = safePoint(positions[node.id]);
        const size = safeSize(node);
        left = Math.min(left, center.x - size.width / 2);
        top = Math.min(top, center.y - size.height / 2);
        right = Math.max(right, center.x + size.width / 2);
        bottom = Math.max(bottom, center.y + size.height / 2);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Intersect an outward ray with the actual rounded rectangle, including its arcs.
 * A zero-length direction uses the right-hand side. Radius is clamped to the box.
 * @param {Point} center @param {Size} size @param {Point} toward
 * @param {number} [radius=12] @returns {Point}
 */
export function roundedRectIntersection(center, size, toward, radius = CARD_RADIUS) {
    const origin = safePoint(center);
    const dimensions = safeSize(size);
    const halfWidth = dimensions.width / 2;
    const halfHeight = dimensions.height / 2;
    const cornerRadius = Math.min(halfWidth, halfHeight, Math.max(0, finite(radius, 0)));
    let dx = finite(toward.x - origin.x, 0);
    let dy = finite(toward.y - origin.y, 0);
    const length = Math.hypot(dx, dy);
    if (!length) { dx = 1; dy = 0; }
    else { dx /= length; dy /= length; }
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let distance = Math.min(ax ? halfWidth / ax : Infinity, ay ? halfHeight / ay : Infinity);
    const hitX = ax * distance;
    const hitY = ay * distance;
    if (cornerRadius && hitX > halfWidth - cornerRadius && hitY > halfHeight - cornerRadius) {
        const circleX = halfWidth - cornerRadius;
        const circleY = halfHeight - cornerRadius;
        const dot = ax * circleX + ay * circleY;
        const discriminant = dot * dot - (circleX * circleX + circleY * circleY - cornerRadius * cornerRadius);
        // The outer root lies on the exposed corner arc; the inner root is inside the card.
        distance = dot + Math.sqrt(Math.max(0, discriminant));
    }
    return { x: origin.x + dx * distance, y: origin.y + dy * distance };
}

/** @param {Curve} curve @param {number} t @returns {Point} */
function pointOnCurve(curve, t) {
    const u = 1 - t;
    if (curve.control2) {
        return {
            x: u ** 3 * curve.start.x + 3 * u * u * t * curve.control.x + 3 * u * t * t * curve.control2.x + t ** 3 * curve.end.x,
            y: u ** 3 * curve.start.y + 3 * u * u * t * curve.control.y + 3 * u * t * t * curve.control2.y + t ** 3 * curve.end.y
        };
    }
    return {
        x: u * u * curve.start.x + 2 * u * t * curve.control.x + t * t * curve.end.x,
        y: u * u * curve.start.y + 2 * u * t * curve.control.y + t * t * curve.end.y
    };
}

/** @param {Point} point @param {GraphNode[]} nodes @param {Positions} positions */
function collisionCount(point, nodes, positions) {
    let count = 0;
    for (const node of nodes) {
        const center = safePoint(positions[node.id]);
        const size = safeSize(node);
        if (Math.abs(point.x - center.x) <= size.width / 2 + LABEL_PADDING
            && Math.abs(point.y - center.y) <= size.height / 2 + LABEL_PADDING) count++;
    }
    return count;
}

/** Keep the label on its Bezier, preferring the real parameter midpoint.
 * @param {Curve} curve @param {GraphNode[]} nodes @param {Positions} positions
 * @returns {LabelCandidate}
 */
function labelOnCurve(curve, nodes, positions) {
    const midpoint = pointOnCurve(curve, 0.5);
    let best = midpoint;
    let bestCollisions = collisionCount(midpoint, nodes, positions);
    if (!bestCollisions) return { point: midpoint, clear: true };
    for (let step = 1; step < 64; step++) {
        for (const t of [0.5 - step / 128, 0.5 + step / 128]) {
            const point = pointOnCurve(curve, t);
            const collisions = collisionCount(point, nodes, positions);
            if (!collisions) return { point, clear: true };
            if (collisions < bestCollisions) { best = point; bestCollisions = collisions; }
        }
    }
    return { point: best, clear: false };
}

/** @param {Point} point */
function coordinates(point) {
    return `${Object.is(point.x, -0) ? 0 : point.x} ${Object.is(point.y, -0) ? 0 : point.y}`;
}

/** @param {Curve} curve */
function pathFor(curve) {
    return curve.control2
        ? `M ${coordinates(curve.start)} C ${coordinates(curve.control)} ${coordinates(curve.control2)} ${coordinates(curve.end)}`
        : `M ${coordinates(curve.start)} Q ${coordinates(curve.control)} ${coordinates(curve.end)}`;
}

/** @param {GraphNode} source @param {GraphNode} target
 * @param {Point} from @param {Point} to @param {number} offset
 * @param {Point} normal @returns {Curve}
 */
function quadratic(source, target, from, to, offset, normal) {
    const control = { x: (from.x + to.x) / 2 + normal.x * offset, y: (from.y + to.y) / 2 + normal.y * offset };
    return {
        start: roundedRectIntersection(from, source, control),
        end: roundedRectIntersection(to, target, control),
        control
    };
}

/** @param {GraphNode} source @param {GraphNode} target
 * @param {Point} from @param {Point} to @param {number} slot
 * @param {number} [extra=0] @returns {Curve}
 */
function loop(source, target, from, to, slot, extra = 0) {
    const sourceSize = safeSize(source);
    const targetSize = safeSize(target);
    const reach = 56 + slot * 38 + extra;
    const control = { x: from.x + sourceSize.width / 2 + reach, y: from.y - sourceSize.height / 2 - reach };
    const control2 = { x: to.x - targetSize.width / 2 - reach, y: to.y - targetSize.height / 2 - reach };
    return {
        start: roundedRectIntersection(from, source, control),
        end: roundedRectIntersection(to, target, control2),
        control,
        control2
    };
}

/** Route all valid edges in stable order. The canonical pair normal is independent
 * of edge direction, so reciprocal and parallel edges occupy different slots.
 * @param {Graph} graph @param {Positions} positions @returns {EdgeRoute[]}
 */
export function routeEdges(graph, positions) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const bounds = boundsFor(graph, positions);
    const escapeDistance = 3 * (Math.hypot(bounds.width, bounds.height) + LABEL_PADDING * 2);
    /** @type {Map<string, GraphEdge[]>} */
    const groups = new Map();
    for (const edge of graph.edges) {
        if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
        const pair = [edge.source, edge.target].sort(compare);
        const key = JSON.stringify(pair);
        const group = groups.get(key) ?? [];
        group.push(edge);
        groups.set(key, group);
    }
    /** @type {EdgeRoute[]} */
    const routes = [];
    for (const key of [...groups.keys()].sort(compare)) {
        const group = groups.get(key);
        if (!group) continue;
        group.sort(compareEdges);
        for (let slot = 0; slot < group.length; slot++) {
            const edge = group[slot];
            const source = nodes.get(edge.source);
            const target = nodes.get(edge.target);
            if (!source || !target) continue;
            const from = safePoint(positions[edge.source]);
            const to = safePoint(positions[edge.target]);
            const reverse = compare(edge.source, edge.target) > 0;
            const dx = reverse ? from.x - to.x : to.x - from.x;
            const dy = reverse ? from.y - to.y : to.y - from.y;
            const distance = Math.hypot(dx, dy);
            const normal = distance ? { x: -dy / distance, y: dx / distance } : { x: 0, y: -1 };
            const spacing = Math.max(72, Math.min(120, distance * 0.2));
            const offset = group.length === 1 ? Math.max(24, Math.min(40, distance * 0.08))
                : (slot - (group.length - 1) / 2) * spacing;
            const isLoop = edge.source === edge.target || distance < 1;
            let curve = isLoop ? loop(source, target, from, to, slot) : quadratic(source, target, from, to, offset, normal);
            let label = labelOnCurve(curve, graph.nodes, positions);
            // Extremely crowded routes may have no free parameter. Increase the
            // same arc outward, retaining its slot side and exact card clipping.
            for (let retry = 1; !label.clear && retry <= 8; retry++) {
                // A retry jump exceeds the whole slot band, so edges that need
                // different retry counts cannot collapse onto the same curve.
                const extra = retry * Math.max(96, spacing * (group.length + 1), escapeDistance);
                const side = offset < 0 ? -1 : 1;
                curve = isLoop ? loop(source, target, from, to, slot, extra)
                    : quadratic(source, target, from, to, offset + side * extra, normal);
                label = labelOnCurve(curve, graph.nodes, positions);
            }
            routes.push({ edge, path: pathFor(curve), label: label.point, start: curve.start, end: curve.end });
        }
    }
    return routes;
}

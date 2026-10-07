// @ts-check
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    // @ts-ignore
    var app = root.App || {};
    // @ts-ignore
    root.App = app;
    var exported = factory();
    for (var key in exported) {
      if (Object.prototype.hasOwnProperty.call(exported, key)) {
        // Do not overwrite existing helpers if they already exist on App
        if (app[key] === undefined || key === 'exportConnectionsPdf') {
          app[key] = exported[key];
        }
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  // Paper constants (ISO 216 dimensions in PDF points @ 72 pt/inch)
  var A4_PT_WIDTH = 595.28;
  var A4_PT_HEIGHT = 841.89;
  var A3_PT_WIDTH = 841.89;
  var A3_PT_HEIGHT = 1190.55;
  var A2_PT_WIDTH = 1190.55;
  var A2_PT_HEIGHT = 1683.78;

  // Thresholds for auto-multipage
  var MIN_READABLE_PT = 7.0; // Font size threshold: below this, detail pages are generated
  var TARGET_PT = 9.0;       // Target readable font size on detail pages
  var OVERLAP_PT = 120.0;    // Overlap between adjacent tiles in world coordinates
  var MAX_PAGES = 24;        // Hard cap on total pages in document
  var BASE_TITLE_PT = 13.0;  // Base node title font size on screen

  // Cubic Bézier kappa for circular arc quarter (4 curves per rounded rect)
  var KAPPA = 0.5522847498;

  // Regular expression to strip emojis and variation selectors
  var EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{200D}]/gu;

  // ---------------------------------------------------------------------------
  // 1. AFM Metrics & Text Measurement (Helvetica & Helvetica-Bold, codes 32..255)
  // ---------------------------------------------------------------------------

  var HELVETICA_WIDTHS = [
    // 32-39
    278, 278, 355, 556, 556, 889, 667, 191,
    // 40-47
    333, 333, 389, 584, 278, 333, 278, 278,
    // 48-55 (0-7)
    556, 556, 556, 556, 556, 556, 556, 556,
    // 56-63 (8-9, :, ;, <, =, >, ?)
    556, 556, 278, 278, 584, 584, 584, 556,
    // 64-71 (@, A-G)
    1015, 667, 667, 722, 722, 667, 611, 778,
    // 72-79 (H-O)
    722, 278, 500, 667, 556, 833, 722, 778,
    // 80-87 (P-W)
    667, 778, 722, 667, 611, 722, 667, 944,
    // 88-95 (X-Z, [, \, ], ^, _)
    667, 667, 611, 278, 278, 278, 469, 556,
    // 96-103 (`, a-g)
    222, 556, 556, 500, 556, 556, 278, 556,
    // 104-111 (h-o)
    556, 222, 222, 500, 222, 833, 556, 556,
    // 112-119 (p-w)
    556, 556, 333, 500, 278, 556, 500, 722,
    // 120-126 (x-z, {, |, }, ~)
    500, 500, 500, 334, 260, 334, 584
  ];

  var HELVETICA_BOLD_WIDTHS = [
    // 32-39
    278, 333, 474, 556, 556, 889, 722, 238,
    // 40-47
    333, 333, 389, 584, 278, 333, 278, 278,
    // 48-55 (0-7)
    556, 556, 556, 556, 556, 556, 556, 556,
    // 56-63 (8-9, :, ;, <, =, >, ?)
    556, 556, 333, 333, 584, 584, 584, 611,
    // 64-71 (@, A-G)
    975, 722, 722, 722, 722, 667, 611, 778,
    // 72-79 (H-O)
    722, 278, 556, 722, 611, 833, 722, 778,
    // 80-87 (P-W)
    667, 778, 722, 667, 611, 722, 667, 944,
    // 88-95 (X-Z, [, \, ], ^, _)
    667, 667, 611, 333, 278, 333, 584, 556,
    // 96-103 (`, a-g)
    278, 556, 611, 556, 611, 556, 333, 611,
    // 104-111 (h-o)
    611, 278, 278, 556, 278, 889, 611, 611,
    // 112-119 (p-w)
    611, 611, 389, 556, 333, 611, 556, 778,
    // 120-126 (x-z, {, |, }, ~)
    556, 556, 500, 389, 280, 389, 584
  ];

  /**
   * Retrieves character width in 1/1000th of an em.
   * @param {number} code
   * @param {boolean} isBold
   * @returns {number}
   */
  function getCharWidth(code, isBold) {
    if (code >= 32 && code <= 126) {
      return (isBold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS)[code - 32];
    }
    // WinAnsi common symbols and Latin-1 supplement
    if (code === 0x85) return 500; // ellipsis
    if (code === 0x96) return 500; // en-dash
    if (code === 0x97) return 1000; // em-dash
    if (code === 0x91 || code === 0x92) return isBold ? 238 : 191; // single quotes
    if (code === 0x93 || code === 0x94) return isBold ? 474 : 355; // double quotes
    if (code === 0x95) return 350; // bullet
    if (code >= 192 && code <= 223) return isBold ? 722 : 667; // uppercase accented
    if (code >= 224 && code <= 255) return isBold ? 611 : 556; // lowercase accented
    return 556; // fallback average width
  }

  /**
   * Measures text width in PDF points.
   * @param {string} text
   * @param {number} fontSize
   * @param {boolean} [isBold]
   * @returns {number}
   */
  function getTextWidth(text, fontSize, isBold) {
    if (!text) return 0;
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      total += getCharWidth(code, !!isBold);
    }
    return (total / 1000) * fontSize;
  }

  /**
   * Wraps text into lines constrained by maxWidth, truncating with ellipsis if needed.
   * @param {string} text
   * @param {number} maxWidth
   * @param {number} fontSize
   * @param {boolean} [isBold]
   * @param {number} [maxLines=3]
   * @returns {string[]}
   */
  function wrapText(text, maxWidth, fontSize, isBold, maxLines) {
    if (!text) return [];
    maxLines = maxLines || 3;
    var clean = text.replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];

    var words = clean.split(' ');
    var lines = [];
    var current = '';

    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var candidate = current ? current + ' ' + word : word;
      if (getTextWidth(candidate, fontSize, isBold) <= maxWidth) {
        current = candidate;
      } else {
        if (current) {
          lines.push(current);
          current = word;
        } else {
          // Single word wider than maxWidth: truncate with ellipsis
          var truncated = '';
          for (var c = 0; c < word.length; c++) {
            var sub = word.slice(0, c + 1) + '…';
            if (getTextWidth(sub, fontSize, isBold) > maxWidth) break;
            truncated = word.slice(0, c + 1);
          }
          lines.push((truncated || word.charAt(0)) + '…');
          current = '';
        }
        if (lines.length === maxLines) break;
      }
    }

    if (current && lines.length < maxLines) {
      lines.push(current);
    } else if (current && lines.length === maxLines) {
      // Add ellipsis to last line if more content remained
      var last = lines[maxLines - 1];
      while (last.length > 0 && getTextWidth(last + '…', fontSize, isBold) > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = last.trim() + '…';
    }

    return lines;
  }

  // ---------------------------------------------------------------------------
  // 2. WinAnsi Encoding & Hex Formatting
  // ---------------------------------------------------------------------------

  /**
   * Sanitizes Unicode string to WinAnsi byte codes, stripping emojis and mapping typography.
   * @param {string} text
   * @returns {number[]}
   */
  function sanitizeWinAnsiCodes(text) {
    if (!text) return [];
    var clean = text
      .replace(EMOJI_REGEX, '')
      .replace(/\s+/g, ' ')
      .normalize('NFC');

    var codes = [];
    for (var i = 0; i < clean.length; i++) {
      var ch = clean.charAt(i);
      var code = clean.charCodeAt(i);

      if (code === 0x2192) { // → right arrow
        codes.push(0x2D, 0x3E); // '->'
      } else if (code === 0x2026) { // …
        codes.push(0x85);
      } else if (code === 0x2014) { // —
        codes.push(0x97);
      } else if (code === 0x2013) { // –
        codes.push(0x96);
      } else if (code === 0x2018) { // ‘
        codes.push(0x91);
      } else if (code === 0x2019) { // ’
        codes.push(0x92);
      } else if (code === 0x201C) { // “
        codes.push(0x93);
      } else if (code === 0x201D) { // ”
        codes.push(0x94);
      } else if (code === 0x2022) { // •
        codes.push(0x95);
      } else if (code === 0x20AC) { // €
        codes.push(0x80);
      } else if (code <= 255) {
        codes.push(code);
      } else {
        codes.push(0x3F); // '?'
      }
    }
    return codes;
  }

  /**
   * Encodes a string as a PDF hexadecimal string (<48656C6C6F>).
   * @param {string} text
   * @returns {string}
   */
  function encodeWinAnsiHex(text) {
    var codes = sanitizeWinAnsiCodes(text);
    var hex = '';
    for (var i = 0; i < codes.length; i++) {
      var h = codes[i].toString(16).toUpperCase();
      hex += h.length === 1 ? '0' + h : h;
    }
    return '<' + hex + '>';
  }

  /**
   * Generates a safe URL slug.
   * @param {string} text
   * @returns {string}
   */
  function slugify(text) {
    if (!text) return 'all-notes';
    var clean = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return clean || 'all-notes';
  }

  /**
   * Formats a Date to YYYY-MM-DD.
   * @param {Date|number} date
   * @returns {string}
   */
  function formatDate(date) {
    var d = typeof date === 'number' ? new Date(date) : date;
    return d.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // 3. SVG Path Parsing & Bézier Elevation
  // ---------------------------------------------------------------------------

  /**
   * Tokenizes an SVG path data string into commands and coordinate numbers.
   * @param {string} d
   * @returns {(string|number)[]}
   */
  function tokenizePath(d) {
    var re = /([a-df-z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
    var tokens = [];
    var m;
    while ((m = re.exec(d)) !== null) {
      if (m[1]) tokens.push(m[1]);
      else if (m[2] !== undefined) tokens.push(parseFloat(m[2]));
    }
    return tokens;
  }

  /**
   * Parses SVG path data commands (M, L, Q, C, Z).
   * @param {string} d
   * @returns {any[]}
   */
  function parseSvgPath(d) {
    var tokens = tokenizePath(d);
    var i = 0;
    var commands = [];
    var currentX = 0;
    var currentY = 0;

    while (i < tokens.length) {
      var cmd = tokens[i++];
      if (typeof cmd !== 'string') continue;

      var isRelative = cmd === cmd.toLowerCase() && cmd !== 'z';
      var upper = cmd.toUpperCase();

      if (upper === 'M') {
        var mx = /** @type {number} */ (tokens[i++]);
        var my = /** @type {number} */ (tokens[i++]);
        if (isRelative) { mx += currentX; my += currentY; }
        currentX = mx; currentY = my;
        commands.push({ type: 'M', x: mx, y: my });
        // Subsequent pairs after M are treated as implicit LineTo
        while (i < tokens.length && typeof tokens[i] === 'number') {
          var lx = /** @type {number} */ (tokens[i++]);
          var ly = /** @type {number} */ (tokens[i++]);
          if (isRelative) { lx += currentX; ly += currentY; }
          currentX = lx; currentY = ly;
          commands.push({ type: 'L', x: lx, y: ly });
        }
      } else if (upper === 'L') {
        while (i < tokens.length && typeof tokens[i] === 'number') {
          var lx = /** @type {number} */ (tokens[i++]);
          var ly = /** @type {number} */ (tokens[i++]);
          if (isRelative) { lx += currentX; ly += currentY; }
          currentX = lx; currentY = ly;
          commands.push({ type: 'L', x: lx, y: ly });
        }
      } else if (upper === 'Q') {
        while (i < tokens.length && typeof tokens[i] === 'number') {
          var qx1 = /** @type {number} */ (tokens[i++]);
          var qy1 = /** @type {number} */ (tokens[i++]);
          var qx = /** @type {number} */ (tokens[i++]);
          var qy = /** @type {number} */ (tokens[i++]);
          if (isRelative) { qx1 += currentX; qy1 += currentY; qx += currentX; qy += currentY; }
          commands.push({ type: 'Q', x0: currentX, y0: currentY, x1: qx1, y1: qy1, x: qx, y: qy });
          currentX = qx; currentY = qy;
        }
      } else if (upper === 'C') {
        while (i < tokens.length && typeof tokens[i] === 'number') {
          var cx1 = /** @type {number} */ (tokens[i++]);
          var cy1 = /** @type {number} */ (tokens[i++]);
          var cx2 = /** @type {number} */ (tokens[i++]);
          var cy2 = /** @type {number} */ (tokens[i++]);
          var cx = /** @type {number} */ (tokens[i++]);
          var cy = /** @type {number} */ (tokens[i++]);
          if (isRelative) { cx1 += currentX; cy1 += currentY; cx2 += currentX; cy2 += currentY; cx += currentX; cy += currentY; }
          commands.push({ type: 'C', x0: currentX, y0: currentY, x1: cx1, y1: cy1, x2: cx2, y2: cy2, x: cx, y: cy });
          currentX = cx; currentY = cy;
        }
      } else if (upper === 'Z') {
        commands.push({ type: 'Z' });
      }
    }
    return commands;
  }

  /**
   * Converts SVG path commands to PDF path operators with degree elevation for quadratic curves.
   * @param {string} d
   * @param {{ x: (v: number) => number, y: (v: number) => number }} transform
   * @returns {string}
   */
  function convertPathToPdf(d, transform) {
    var commands = parseSvgPath(d);
    var ops = [];

    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i];
      if (cmd.type === 'M') {
        ops.push(transform.x(cmd.x).toFixed(2) + ' ' + transform.y(cmd.y).toFixed(2) + ' m');
      } else if (cmd.type === 'L') {
        ops.push(transform.x(cmd.x).toFixed(2) + ' ' + transform.y(cmd.y).toFixed(2) + ' l');
      } else if (cmd.type === 'Q') {
        // Degree elevation: convert quadratic Bézier to cubic Bézier
        var cp1x = (cmd.x0 + 2 * cmd.x1) / 3;
        var cp1y = (cmd.y0 + 2 * cmd.y1) / 3;
        var cp2x = (cmd.x + 2 * cmd.x1) / 3;
        var cp2y = (cmd.y + 2 * cmd.y1) / 3;
        ops.push(
          transform.x(cp1x).toFixed(2) + ' ' + transform.y(cp1y).toFixed(2) + ' ' +
          transform.x(cp2x).toFixed(2) + ' ' + transform.y(cp2y).toFixed(2) + ' ' +
          transform.x(cmd.x).toFixed(2) + ' ' + transform.y(cmd.y).toFixed(2) + ' c'
        );
      } else if (cmd.type === 'C') {
        ops.push(
          transform.x(cmd.x1).toFixed(2) + ' ' + transform.y(cmd.y1).toFixed(2) + ' ' +
          transform.x(cmd.x2).toFixed(2) + ' ' + transform.y(cmd.y2).toFixed(2) + ' ' +
          transform.x(cmd.x).toFixed(2) + ' ' + transform.y(cmd.y).toFixed(2) + ' c'
        );
      } else if (cmd.type === 'Z') {
        ops.push('h');
      }
    }
    return ops.join(' ');
  }

  /**
   * Generates PDF path operators for a rounded rectangle using 4 cubic Bézier arcs.
   * @param {number} x Left in PDF space
   * @param {number} y Bottom in PDF space
   * @param {number} w Width
   * @param {number} h Height
   * @param {number} r Radius
   * @returns {string}
   */
  function roundedRectPdf(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r === 0) {
      return x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re';
    }
    var k = r * KAPPA;
    var x0 = x, x1 = x + r, x2 = x + w - r, x3 = x + w;
    var y0 = y, y1 = y + r, y2 = y + h - r, y3 = y + h;

    return [
      x1.toFixed(2) + ' ' + y0.toFixed(2) + ' m',
      x2.toFixed(2) + ' ' + y0.toFixed(2) + ' l',
      (x2 + k).toFixed(2) + ' ' + y0.toFixed(2) + ' ' + x3.toFixed(2) + ' ' + (y1 - k).toFixed(2) + ' ' + x3.toFixed(2) + ' ' + y1.toFixed(2) + ' c',
      x3.toFixed(2) + ' ' + y2.toFixed(2) + ' l',
      x3.toFixed(2) + ' ' + (y2 + k).toFixed(2) + ' ' + (x2 + k).toFixed(2) + ' ' + y3.toFixed(2) + ' ' + x2.toFixed(2) + ' ' + y3.toFixed(2) + ' c',
      x1.toFixed(2) + ' ' + y3.toFixed(2) + ' l',
      (x1 - k).toFixed(2) + ' ' + y3.toFixed(2) + ' ' + x0.toFixed(2) + ' ' + (y2 + k).toFixed(2) + ' ' + x0.toFixed(2) + ' ' + y2.toFixed(2) + ' c',
      x0.toFixed(2) + ' ' + y1.toFixed(2) + ' l',
      x0.toFixed(2) + ' ' + (y1 - k).toFixed(2) + ' ' + (x1 - k).toFixed(2) + ' ' + y0.toFixed(2) + ' ' + x1.toFixed(2) + ' ' + y0.toFixed(2) + ' c',
      'h'
    ].join(' ');
  }

  // ---------------------------------------------------------------------------
  // 4. Geometry Extraction (Option B: SVG DOM Inspection)
  // ---------------------------------------------------------------------------

  /**
   * Extracts clean semantic vector primitives from the SVG clone.
   * @param {SVGSVGElement} svg
   * @returns {{ nodes: any[], edges: any[], bounds: { x: number, y: number, width: number, height: number, hasNodes: boolean } }}
   */
  function parseSvgGeometry(svg) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var nodes = [];
    var edges = [];

    var nodeGroups = svg.querySelectorAll('.graph-node');
    nodeGroups.forEach(function (g) {
      var transform = g.getAttribute('transform') || '';
      var match = transform.match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/);
      if (!match) return;

      var x = parseFloat(match[1]);
      var y = parseFloat(match[2]);
      var card = g.querySelector('.graph-node-card') || g.querySelector('rect');
      var w = card ? parseFloat(card.getAttribute('width') || '232') : 232;
      var h = card ? parseFloat(card.getAttribute('height') || '96') : 96;

      var left = x - w / 2;
      var top = y - h / 2;

      minX = Math.min(minX, left - 10);
      maxX = Math.max(maxX, left + w + 10);
      minY = Math.min(minY, top - 10);
      maxY = Math.max(maxY, top + h + 10);

      var isFocused = g.classList.contains('focused') || g.classList.contains('is-selected');
      var isContext = g.classList.contains('context-node');

      // Title lines extraction
      var titleElem = g.querySelector('.graph-node-title');
      var titleLines = [];
      if (titleElem) {
        var tspans = titleElem.querySelectorAll('tspan');
        if (tspans.length > 0) {
          tspans.forEach(function (ts) { titleLines.push(ts.textContent || ''); });
        } else {
          titleLines.push(titleElem.textContent || '');
        }
      }

      // Kind badge
      var kindElem = g.querySelector('.graph-node-kind');
      var kind = kindElem ? (kindElem.textContent || 'note') : 'note';

      nodes.push({
        id: g.getAttribute('data-node-id') || '',
        cx: x, cy: y,
        left: left, top: top,
        width: w, height: h,
        isFocused: isFocused,
        isContext: isContext,
        titleLines: titleLines,
        kind: kind
      });
    });

    var hasNodes = nodes.length > 0;

    // Edge paths
    var edgeElements = svg.querySelectorAll('.graph-edge');
    edgeElements.forEach(function (edge) {
      var d = edge.getAttribute('d') || '';
      if (!d) return;

      var isDepends = edge.classList.contains('depends-on');
      var isRelated = edge.classList.contains('related');
      var type = isDepends ? 'depends-on' : (isRelated ? 'related' : 'part-of');

      var commands = parseSvgPath(d);
      edges.push({ type: type, d: d, commands: commands });

      // Factor curve points into bounding box
      for (var c = 0; c < commands.length; c++) {
        var pt = commands[c];
        if (pt.x !== undefined && isFinite(pt.x)) {
          minX = Math.min(minX, pt.x - 20);
          maxX = Math.max(maxX, pt.x + 20);
        }
        if (pt.y !== undefined && isFinite(pt.y)) {
          minY = Math.min(minY, pt.y - 20);
          maxY = Math.max(maxY, pt.y + 20);
        }
      }
    });

    // Edge labels
    var labelElements = svg.querySelectorAll('.graph-edge-label');
    labelElements.forEach(function (lbl) {
      var parent = lbl.parentElement;
      var text = lbl.textContent || '';
      var lx = 0, ly = 0;
      if (parent && parent.getAttribute('transform')) {
        var m = (parent.getAttribute('transform') || '').match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/);
        if (m) { lx = parseFloat(m[1]); ly = parseFloat(m[2]); }
      } else {
        lx = parseFloat(lbl.getAttribute('x') || '0');
        ly = parseFloat(lbl.getAttribute('y') || '0');
      }
      if (text && isFinite(lx) && isFinite(ly)) {
        edges.push({ isLabel: true, text: text, x: lx, y: ly });
      }
    });

    if (!isFinite(minX) || !isFinite(minY) || maxX <= minX || maxY <= minY) {
      minX = 0; minY = 0;
      maxX = parseFloat(svg.getAttribute('width') || '800');
      maxY = parseFloat(svg.getAttribute('height') || '300');
    }

    var pad = 24;
    return {
      nodes: nodes,
      edges: edges,
      bounds: {
        x: minX - pad,
        y: minY - pad,
        width: (maxX - minX) + pad * 2,
        height: (maxY - minY) + pad * 2,
        hasNodes: hasNodes
      }
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Multi-page Detail Grid Planner
  // ---------------------------------------------------------------------------

  /**
   * Plans the page count, tile grid, paper size, and culling bounds.
   * @param {{ x: number, y: number, width: number, height: number, hasNodes: boolean }} bbox
   * @param {any} [opts]
   */
  function planTiles(bbox, opts) {
    opts = opts || {};
    var minReadablePt = opts.minReadablePt || MIN_READABLE_PT;
    var targetPt = opts.targetPt || TARGET_PT;
    var overlapPt = opts.overlapPt || OVERLAP_PT;
    var maxPages = opts.maxPages || MAX_PAGES;
    var baseTitlePt = opts.baseTitlePt || BASE_TITLE_PT;

    var isLandscape = (bbox.width / bbox.height) >= 1.15;
    var pw = isLandscape ? A4_PT_HEIGHT : A4_PT_WIDTH;
    var ph = isLandscape ? A4_PT_WIDTH : A4_PT_HEIGHT;

    var margin = 36;
    var availW = pw - margin * 2;
    var availH = ph - margin * 2 - 50 - 36;

    var overviewScale = Math.min(availW / bbox.width, availH / bbox.height);
    var effectiveTitlePt = baseTitlePt * overviewScale;

    // Small or medium graphs fit in a single page
    if (effectiveTitlePt >= minReadablePt || !bbox.hasNodes) {
      return {
        isMultiPage: false,
        paper: { name: 'A4', pw: pw, ph: ph, isLandscape: isLandscape },
        overviewScale: Math.min(overviewScale, 1.25),
        detailScale: 1,
        cols: 1, rows: 1,
        tiles: []
      };
    }

    // Large graphs: calculate detail tiles with paper escalation
    var detailScale = targetPt / baseTitlePt;
    var papers = [
      { name: 'A4', pw: pw, ph: ph, isLandscape: isLandscape },
      { name: 'A3', pw: isLandscape ? A3_PT_HEIGHT : A3_PT_WIDTH, ph: isLandscape ? A3_PT_WIDTH : A3_PT_HEIGHT, isLandscape: isLandscape },
      { name: 'A2', pw: isLandscape ? A2_PT_HEIGHT : A2_PT_WIDTH, ph: isLandscape ? A2_PT_WIDTH : A2_PT_HEIGHT, isLandscape: isLandscape }
    ];

    var chosenPaper = papers[0];
    var cols = 1, rows = 1;

    for (var p = 0; p < papers.length; p++) {
      chosenPaper = papers[p];
      var dAvailW = chosenPaper.pw - margin * 2;
      var dAvailH = chosenPaper.ph - margin * 2 - 42 - 30;
      var worldTileW = dAvailW / detailScale;
      var worldTileH = dAvailH / detailScale;
      var stepX = Math.max(10, worldTileW - overlapPt);
      var stepY = Math.max(10, worldTileH - overlapPt);
      cols = Math.max(1, Math.ceil((bbox.width - overlapPt) / stepX));
      rows = Math.max(1, Math.ceil((bbox.height - overlapPt) / stepY));
      if (cols * rows < maxPages) break;
    }

    var dW = chosenPaper.pw - margin * 2;
    var dH = chosenPaper.ph - margin * 2 - 42 - 30;
    var tWidth = dW / detailScale;
    var tHeight = dH / detailScale;
    var sX = Math.max(10, tWidth - overlapPt);
    var sY = Math.max(10, tHeight - overlapPt);

    var tiles = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (tiles.length >= maxPages - 1) break;
        tiles.push({
          row: r, col: c,
          x: bbox.x + c * sX,
          y: bbox.y + r * sY,
          width: tWidth, height: tHeight
        });
      }
    }

    return {
      isMultiPage: true,
      paper: chosenPaper,
      overviewScale: Math.min(overviewScale, 1.25),
      detailScale: detailScale,
      cols: cols, rows: rows,
      tiles: tiles
    };
  }

  // ---------------------------------------------------------------------------
  // 6. PDF Vector Document Assembler (ISO 32000 compliant)
  // ---------------------------------------------------------------------------

  /**
   * Compresses content stream using CompressionStream('deflate') with graceful fallback.
   * @param {string} text
   * @returns {Promise<{ bytes: Uint8Array, filter: string }>}
   */
  async function compressContentStream(text) {
    var enc = new TextEncoder();
    var uncompressed = enc.encode(text);
    if (typeof CompressionStream !== 'function') {
      return { bytes: uncompressed, filter: '' };
    }
    try {
      var cs = new CompressionStream('deflate');
      var writer = cs.writable.getWriter();
      writer.write(uncompressed);
      writer.close();
      var reader = cs.readable.getReader();
      var chunks = [];
      while (true) {
        var res = await reader.read();
        if (res.done) break;
        chunks.push(res.value);
      }
      var total = chunks.reduce(function (sum, c) { return sum + c.length; }, 0);
      var result = new Uint8Array(total);
      var pos = 0;
      for (var i = 0; i < chunks.length; i++) {
        result.set(chunks[i], pos);
        pos += chunks[i].length;
      }
      return { bytes: result, filter: '/Filter /FlateDecode' };
    } catch (_) {
      return { bytes: uncompressed, filter: '' };
    }
  }

  /**
   * Renders the header and divider on a page.
   * @param {string} title
   * @param {string} subtitle
   * @param {string} rightText1
   * @param {string} rightText2
   * @param {number} pw
   * @param {number} ph
   * @param {number} margin
   * @returns {string}
   */
  function renderHeaderPdf(title, subtitle, rightText1, rightText2, pw, ph, margin) {
    var ops = [];
    // Title
    ops.push('BT /F2 18 Tf 0.06 0.09 0.16 rg ' + margin.toFixed(2) + ' ' + (ph - margin - 18).toFixed(2) + ' Td ' + encodeWinAnsiHex(title) + ' Tj ET');
    // Subtitle
    ops.push('BT /F1 11 Tf 0.28 0.33 0.41 rg ' + margin.toFixed(2) + ' ' + (ph - margin - 35).toFixed(2) + ' Td ' + encodeWinAnsiHex(subtitle) + ' Tj ET');

    // Right-aligned status and date
    var right1W = getTextWidth(rightText1, 11, false);
    var right2W = getTextWidth(rightText2, 10, false);
    ops.push('BT /F1 11 Tf 0.28 0.33 0.41 rg ' + (pw - margin - right1W).toFixed(2) + ' ' + (ph - margin - 18).toFixed(2) + ' Td ' + encodeWinAnsiHex(rightText1) + ' Tj ET');
    ops.push('BT /F1 10 Tf 0.58 0.64 0.72 rg ' + (pw - margin - right2W).toFixed(2) + ' ' + (ph - margin - 35).toFixed(2) + ' Td ' + encodeWinAnsiHex(rightText2) + ' Tj ET');

    // Header divider line
    ops.push('0.89 0.91 0.94 RG 1 w ' + margin.toFixed(2) + ' ' + (ph - margin - 46).toFixed(2) + ' m ' + (pw - margin).toFixed(2) + ' ' + (ph - margin - 46).toFixed(2) + ' l S');
    return ops.join('\n');
  }

  /**
   * Renders the relationship legend at the footer of a page.
   * @param {number} pw
   * @param {number} ph
   * @param {number} margin
   * @returns {string}
   */
  function renderLegendPdf(pw, ph, margin) {
    var ops = [];
    var dividerY = margin + 26;
    ops.push('0.89 0.91 0.94 RG 1 w ' + margin.toFixed(2) + ' ' + dividerY.toFixed(2) + ' m ' + (pw - margin).toFixed(2) + ' ' + dividerY.toFixed(2) + ' l S');

    var legendY = margin + 8;
    var items = [
      { text: 'Part of -> context', colorStroke: '0.04 0.41 0.85 RG', dash: '[] 0 d', fill: '0.04 0.41 0.85 rg' },
      { text: 'Related to', colorStroke: '0.39 0.45 0.55 RG', dash: '[5 3] 0 d', fill: '0.39 0.45 0.55 rg' },
      { text: 'Depends on -> prerequisite', colorStroke: '0.85 0.47 0.02 RG', dash: '[2 3] 0 d', fill: '0.85 0.47 0.02 rg' }
    ];

    var lineWidth = 20;
    var lineGap = 6;
    var itemGap = 18;
    var totalW = 0;
    var itemWidths = [];

    for (var i = 0; i < items.length; i++) {
      var w = lineWidth + lineGap + getTextWidth(items[i].text, 10, false);
      itemWidths.push(w);
      totalW += w + (i < items.length - 1 ? itemGap : 0);
    }

    var startX = (pw - totalW) / 2;
    var currX = startX;

    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      ops.push(it.colorStroke + ' 2 w ' + it.dash + ' ' + currX.toFixed(2) + ' ' + (legendY + 3).toFixed(2) + ' m ' + (currX + lineWidth).toFixed(2) + ' ' + (legendY + 3).toFixed(2) + ' l S [] 0 d');
      currX += lineWidth + lineGap;
      ops.push('BT /F1 10 Tf 0.28 0.33 0.41 rg ' + currX.toFixed(2) + ' ' + legendY.toFixed(2) + ' Td ' + encodeWinAnsiHex(it.text) + ' Tj ET');
      currX += getTextWidth(it.text, 10, false) + itemGap;
    }

    return ops.join('\n');
  }

  /**
   * Draws a graph node in PDF vector operators.
   * @param {any} node
   * @param {{ x: (v: number) => number, y: (v: number) => number, scale: number }} transform
   * @returns {string}
   */
  function renderNodePdf(node, transform) {
    var ops = [];
    var x = transform.x(node.left);
    var yTop = transform.y(node.top);
    var w = node.width * transform.scale;
    var h = node.height * transform.scale;
    var yBottom = yTop - h; // Bottom in PDF coordinates

    // Card background and border
    if (node.isFocused) {
      ops.push('0.94 0.97 1 rg 0.04 0.41 0.85 RG ' + (2.5 * transform.scale).toFixed(2) + ' w');
    } else if (node.isContext) {
      ops.push('0.97 0.98 0.99 rg 0.01 0.52 0.78 RG ' + (2 * transform.scale).toFixed(2) + ' w');
    } else {
      ops.push('1 1 1 rg 0.8 0.84 0.88 RG ' + (1.4 * transform.scale).toFixed(2) + ' w');
    }
    ops.push(roundedRectPdf(x, yBottom, w, h, 12 * transform.scale) + ' B');

    // Title lines
    var titleSize = Math.max(6, 12 * transform.scale);
    ops.push('0.06 0.09 0.16 rg');
    var lines = node.titleLines && node.titleLines.length ? node.titleLines : [node.id || 'Untitled'];
    for (var i = 0; i < lines.length; i++) {
      var tx = x + 16 * transform.scale;
      var ty = yTop - (26 + i * 18) * transform.scale;
      ops.push('BT /F2 ' + titleSize.toFixed(2) + ' Tf ' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ' Td ' + encodeWinAnsiHex(lines[i]) + ' Tj ET');
    }

    // Kind badge
    var badgeW = Math.max(50, getTextWidth(node.kind || 'note', 9, false) + 26) * transform.scale;
    var badgeH = 20 * transform.scale;
    var bx = x + 16 * transform.scale;
    var by = yBottom + 12 * transform.scale;
    ops.push('0.95 0.96 0.98 rg ' + roundedRectPdf(bx, by, badgeW, badgeH, 6 * transform.scale) + ' f');
    ops.push('0.28 0.33 0.41 rg BT /F1 ' + Math.max(5, 9 * transform.scale).toFixed(2) + ' Tf ' + (bx + 8 * transform.scale).toFixed(2) + ' ' + (by + 5.5 * transform.scale).toFixed(2) + ' Td ' + encodeWinAnsiHex(node.kind || 'note') + ' Tj ET');

    return ops.join('\n');
  }

  /**
   * Draws a graph edge and its arrow tip in PDF vector operators.
   * @param {any} edge
   * @param {{ x: (v: number) => number, y: (v: number) => number, scale: number }} transform
   * @returns {string}
   */
  function renderEdgePdf(edge, transform) {
    if (edge.isLabel) {
      var lw = (getTextWidth(edge.text, 10, false) + 16) * transform.scale;
      var lh = 22 * transform.scale;
      var lx = transform.x(edge.x) - lw / 2;
      var ly = transform.y(edge.y) - lh / 2;
      return [
        '1 1 1 rg 0.89 0.91 0.94 RG ' + (1 * transform.scale).toFixed(2) + ' w ' + roundedRectPdf(lx, ly, lw, lh, lh / 2) + ' B',
        '0.28 0.33 0.41 rg BT /F1 ' + Math.max(5, 10 * transform.scale).toFixed(2) + ' Tf ' + (lx + 8 * transform.scale).toFixed(2) + ' ' + (ly + 6.5 * transform.scale).toFixed(2) + ' Td ' + encodeWinAnsiHex(edge.text) + ' Tj ET'
      ].join('\n');
    }

    var ops = [];
    var strokeColor = '0.04 0.41 0.85';
    var dash = '[] 0 d';
    var fillColor = '0.04 0.41 0.85';

    if (edge.type === 'depends-on') {
      strokeColor = '0.85 0.47 0.02';
      fillColor = '0.85 0.47 0.02';
      dash = '[' + (2 * transform.scale).toFixed(2) + ' ' + (4 * transform.scale).toFixed(2) + '] 0 d';
    } else if (edge.type === 'related') {
      strokeColor = '0.39 0.45 0.55';
      fillColor = '0.39 0.45 0.55';
      dash = '[' + (6 * transform.scale).toFixed(2) + ' ' + (4 * transform.scale).toFixed(2) + '] 0 d';
    }

    ops.push(strokeColor + ' RG ' + (1.6 * transform.scale).toFixed(2) + ' w ' + dash);
    ops.push(convertPathToPdf(edge.d, transform) + ' S [] 0 d');

    // Arrow tip calculation
    if (edge.commands && edge.commands.length >= 2) {
      var last = edge.commands[edge.commands.length - 1];
      var prev = edge.commands[edge.commands.length - 2];
      var endX = transform.x(last.x);
      var endY = transform.y(last.y);
      var fromX = transform.x(last.x1 !== undefined ? (last.x2 !== undefined ? last.x2 : last.x1) : prev.x);
      var fromY = transform.y(last.y1 !== undefined ? (last.y2 !== undefined ? last.y2 : last.y1) : prev.y);

      var dx = endX - fromX;
      var dy = endY - fromY;
      var len = Math.hypot(dx, dy);
      if (len > 0.01) {
        var ux = dx / len;
        var uy = dy / len;
        var nx = -uy;
        var ny = ux;
        var arrowL = 8 * transform.scale;
        var arrowW = 4.5 * transform.scale;

        var bX = endX - ux * arrowL;
        var bY = endY - uy * arrowL;
        var c1X = bX + nx * arrowW;
        var c1Y = bY + ny * arrowW;
        var c2X = bX - nx * arrowW;
        var c2Y = bY - ny * arrowW;

        ops.push(fillColor + ' rg ' + strokeColor + ' RG ' + (1 * transform.scale).toFixed(2) + ' w');
        ops.push(endX.toFixed(2) + ' ' + endY.toFixed(2) + ' m ' + c1X.toFixed(2) + ' ' + c1Y.toFixed(2) + ' l ' + c2X.toFixed(2) + ' ' + c2Y.toFixed(2) + ' l h f');
      }
    }

    return ops.join('\n');
  }

  /**
   * Builds the complete vector PDF binary for the document (single or multi-page).
   * @param {any} geom
   * @param {any} plan
   * @param {{ focusTitle: string, statusText: string, dateStr: string, appName: string }} meta
   * @returns {Promise<Uint8Array>}
   */
  async function buildVectorPdfDocument(geom, plan, meta) {
    var isMulti = plan.isMultiPage;
    var pw = plan.paper.pw;
    var ph = plan.paper.ph;
    var margin = 36;
    var appName = meta.appName || 'memorai';

    var pageContentStreams = [];

    // --- Page 1: Overview ---
    var oAvailW = pw - margin * 2;
    var oAvailH = ph - margin * 2 - 50 - 36;
    var oScale = plan.overviewScale;
    var oDrawW = geom.bounds.width * oScale;
    var oDrawH = geom.bounds.height * oScale;
    var oOffsetX = margin + (oAvailW - oDrawW) / 2;
    var oOffsetY = margin + 50 + (oAvailH - oDrawH) / 2;

    var oTransform = {
      x: function (wx) { return oOffsetX + (wx - geom.bounds.x) * oScale; },
      y: function (wy) { return ph - (oOffsetY + (wy - geom.bounds.y) * oScale); },
      scale: oScale
    };

    var p1Ops = [];
    p1Ops.push(renderHeaderPdf(
      appName + ' Connections',
      meta.focusTitle ? 'Focus: ' + meta.focusTitle : 'All notes',
      meta.statusText || '0 notes · 0 direct links',
      'Exported: ' + meta.dateStr + (isMulti ? ' · Overview (1/' + (plan.tiles.length + 1) + ')' : ''),
      pw, ph, margin
    ));

    if (geom.bounds.hasNodes) {
      for (var e = 0; e < geom.edges.length; e++) {
        p1Ops.push(renderEdgePdf(geom.edges[e], oTransform));
      }
      for (var n = 0; n < geom.nodes.length; n++) {
        p1Ops.push(renderNodePdf(geom.nodes[n], oTransform));
      }
    } else {
      // Empty state box
      var emW = 320, emH = 70;
      var emX = (pw - emW) / 2;
      var emY = (ph - emH) / 2;
      p1Ops.push('0.97 0.98 0.99 rg 0.89 0.91 0.94 RG 1 w ' + roundedRectPdf(emX, emY, emW, emH, 8) + ' B');
      p1Ops.push('0.2 0.25 0.33 rg BT /F2 13 Tf ' + (pw / 2 - 75).toFixed(2) + ' ' + (emY + 40).toFixed(2) + ' Td ' + encodeWinAnsiHex('No connections to display') + ' Tj ET');
      p1Ops.push('0.39 0.45 0.55 rg BT /F1 10 Tf ' + (pw / 2 - 130).toFixed(2) + ' ' + (emY + 22).toFixed(2) + ' Td ' + encodeWinAnsiHex('Create notes and connect them through a context.') + ' Tj ET');
    }

    p1Ops.push(renderLegendPdf(pw, ph, margin));
    pageContentStreams.push(p1Ops.join('\n'));

    // --- Pages 2..N: Detail Tiles ---
    if (isMulti) {
      var dAvailW = pw - margin * 2;
      var dAvailH = ph - margin * 2 - 42 - 30;
      var dScale = plan.detailScale;
      var totalPages = plan.tiles.length + 1;

      for (var t = 0; t < plan.tiles.length; t++) {
        var tile = plan.tiles[t];
        var pageNum = t + 2;
        var tOps = [];

        // Detail header with section coordinate and page index
        var sectionTitle = 'Section R' + (tile.row + 1) + '/C' + (tile.col + 1) + ' (' + pageNum + '/' + totalPages + ')';
        tOps.push(renderHeaderPdf(
          appName + ' Connections · ' + sectionTitle,
          meta.focusTitle ? 'Focus: ' + meta.focusTitle : 'Detail Map',
          meta.statusText || '',
          'Exported: ' + meta.dateStr,
          pw, ph, margin
        ));

        // Clip graph area
        var clipY = margin + 30;
        tOps.push('q ' + margin.toFixed(2) + ' ' + clipY.toFixed(2) + ' ' + dAvailW.toFixed(2) + ' ' + dAvailH.toFixed(2) + ' re W n');

        var dTransform = {
          x: function (wx) { return margin + (wx - tile.x) * dScale; },
          y: function (wy) { return ph - (margin + 42 + (wy - tile.y) * dScale); },
          scale: dScale
        };

        // Spatial culling: only render nodes intersecting this tile
        for (var di = 0; di < geom.edges.length; di++) {
          tOps.push(renderEdgePdf(geom.edges[di], dTransform));
        }
        for (var ni = 0; ni < geom.nodes.length; ni++) {
          var nd = geom.nodes[ni];
          if (nd.left + nd.width >= tile.x && nd.left <= tile.x + tile.width &&
              nd.top + nd.height >= tile.y && nd.top <= tile.y + tile.height) {
            tOps.push(renderNodePdf(nd, dTransform));
          }
        }
        tOps.push('Q'); // End clipping

        // Minimap in top-right corner
        var mmW = 68, mmH = 46;
        var mmX = pw - margin - mmW;
        var mmY = ph - margin - 40;
        tOps.push('0.97 0.98 0.99 rg 0.85 0.88 0.92 RG 1 w ' + roundedRectPdf(mmX, mmY, mmW, mmH, 4) + ' B');

        // Minimap active tile rectangle
        var mmScaleX = mmW / geom.bounds.width;
        var mmScaleY = mmH / geom.bounds.height;
        var mmBoxX = mmX + (tile.x - geom.bounds.x) * mmScaleX;
        var mmBoxY = mmY + mmH - (tile.y - geom.bounds.y + tile.height) * mmScaleY;
        var mmBoxW = Math.max(4, tile.width * mmScaleX);
        var mmBoxH = Math.max(4, tile.height * mmScaleY);
        tOps.push('0.9 0.95 1 rg 0.04 0.41 0.85 RG 1.2 w ' + roundedRectPdf(mmBoxX, mmBoxY, mmBoxW, mmBoxH, 2) + ' B');

        tOps.push(renderLegendPdf(pw, ph, margin));
        pageContentStreams.push(tOps.join('\n'));
      }
    }

    // --- Compress content streams ---
    var compressedStreams = [];
    for (var s = 0; s < pageContentStreams.length; s++) {
      compressedStreams.push(await compressContentStream(pageContentStreams[s]));
    }

    // --- Build binary PDF structure ---
    var enc = new TextEncoder();
    var chunks = [];
    var currentOffset = 0;

    function pushAscii(str) {
      var b = enc.encode(str);
      chunks.push(b);
      currentOffset += b.length;
      return currentOffset;
    }

    function pushBinary(b) {
      chunks.push(b);
      currentOffset += b.length;
      return currentOffset;
    }

    pushAscii('%PDF-1.4\n');
    pushBinary(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // %âãÏÓ

    var offsets = [];
    var totalPageCount = compressedStreams.length;

    // Object numbering:
    // 1: Catalog
    // 2: Pages
    // Page objects: 3 to (2 + totalPageCount)
    // Content stream objects: (3 + totalPageCount) to (2 + totalPageCount * 2)
    // Fonts: F1, F2
    // Info dictionary
    var pageStartId = 3;
    var contentStartId = pageStartId + totalPageCount;
    var fontF1Id = contentStartId + totalPageCount;
    var fontF2Id = fontF1Id + 1;
    var infoId = fontF2Id + 1;

    // 1: Catalog
    offsets[1] = currentOffset;
    pushAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Lang (en) >>\nendobj\n');

    // 2: Pages
    offsets[2] = currentOffset;
    var kids = [];
    for (var k = 0; k < totalPageCount; k++) kids.push((pageStartId + k) + ' 0 R');
    pushAscii('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + totalPageCount + ' >>\nendobj\n');

    // Page objects
    for (var pIdx = 0; pIdx < totalPageCount; pIdx++) {
      var objId = pageStartId + pIdx;
      var cId = contentStartId + pIdx;
      offsets[objId] = currentOffset;
      pushAscii(
        objId + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
        pw.toFixed(2) + ' ' + ph.toFixed(2) +
        '] /Resources << /Font << /F1 ' + fontF1Id + ' 0 R /F2 ' + fontF2Id +
        ' 0 R >> >> /Contents ' + cId + ' 0 R >>\nendobj\n'
      );
    }

    // Content stream objects
    for (var cIdx = 0; cIdx < totalPageCount; cIdx++) {
      var streamObjId = contentStartId + cIdx;
      var cStream = compressedStreams[cIdx];
      offsets[streamObjId] = currentOffset;
      var filterClause = cStream.filter ? ' ' + cStream.filter : '';
      pushAscii(streamObjId + ' 0 obj\n<< /Length ' + cStream.bytes.length + filterClause + ' >>\nstream\n');
      pushBinary(cStream.bytes);
      pushAscii('\nendstream\nendobj\n');
    }

    // Indirect Font objects
    offsets[fontF1Id] = currentOffset;
    pushAscii(fontF1Id + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');

    offsets[fontF2Id] = currentOffset;
    pushAscii(fontF2Id + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');

    // Info metadata
    offsets[infoId] = currentOffset;
    var dateFormatted = meta.dateStr.replace(/-/g, '');
    var safeTitle = (meta.focusTitle || 'Connections').replace(/[()]/g, '');
    pushAscii(
      infoId + ' 0 obj\n<< /Title (' + safeTitle + ') /Creator (' + appName +
      ') /Producer (' + appName + ' Native Vector Engine) /CreationDate (D:' +
      dateFormatted + '120000Z) >>\nendobj\n'
    );

    // Cross-reference table
    var totalObjects = infoId;
    var xrefStart = currentOffset;
    var xrefStr = 'xref\n0 ' + (totalObjects + 1) + '\n0000000000 65535 f \n';
    for (var o = 1; o <= totalObjects; o++) {
      var offStr = String(offsets[o]).padStart(10, '0');
      xrefStr += offStr + ' 00000 n \n';
    }
    xrefStr += 'trailer\n<< /Size ' + (totalObjects + 1) + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n';
    pushAscii(xrefStr);

    var finalLength = chunks.reduce(function (sum, c) { return sum + c.length; }, 0);
    var pdfBytes = new Uint8Array(finalLength);
    var writePos = 0;
    for (var ch = 0; ch < chunks.length; ch++) {
      pdfBytes.set(chunks[ch], writePos);
      writePos += chunks[ch].length;
    }
    return pdfBytes;
  }

  // ---------------------------------------------------------------------------
  // 7. Raster Pipeline Fallback (Pre-existing mechanism)
  // ---------------------------------------------------------------------------

  /**
   * Fallback raster PDF generator.
   */
  async function generateRasterFallback(svg, meta) {
    var geom = parseSvgGeometry(svg);
    var bounds = geom.bounds;
    var isLandscape = bounds.hasNodes && (bounds.width / bounds.height) >= 1.15;
    var ptWidth = isLandscape ? A4_PT_HEIGHT : A4_PT_WIDTH;
    var ptHeight = isLandscape ? A4_PT_WIDTH : A4_PT_HEIGHT;
    var scale = 2.0;

    var canvas = document.createElement('canvas');
    canvas.width = Math.round(ptWidth * scale);
    canvas.height = Math.round(ptHeight * scale);
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D canvas context');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);

    var margin = 36;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('Connections', margin, margin + 18);

    var subtitle = meta.focusTitle ? 'Focus: ' + meta.focusTitle : 'All notes';
    ctx.fillStyle = '#475569';
    ctx.font = '500 11px sans-serif';
    ctx.fillText(subtitle, margin, margin + 35);
    ctx.restore();

    var jpegBlob = await new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Raster fallback JPEG encode failed'));
      }, 'image/jpeg', 0.9);
    });

    var jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());

    // Single image XObject PDF
    var enc = new TextEncoder();
    var chunks = [];
    var off = 0;
    function addA(s) { var b = enc.encode(s); chunks.push(b); off += b.length; }
    function addB(b) { chunks.push(b); off += b.length; }

    addA('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    var offs = [];
    offs[1] = off; addA('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offs[2] = off; addA('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    offs[3] = off; addA('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptWidth.toFixed(2) + ' ' + ptHeight.toFixed(2) + '] /Resources << /XObject << /Img 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
    offs[4] = off; addA('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpegBytes.length + ' >>\nstream\n');
    addB(jpegBytes);
    addA('\nendstream\nendobj\n');
    offs[5] = off;
    var cStr = 'q ' + ptWidth.toFixed(2) + ' 0 0 ' + ptHeight.toFixed(2) + ' 0 0 cm /Img Do Q\n';
    addA('5 0 obj\n<< /Length ' + cStr.length + ' >>\nstream\n' + cStr + 'endstream\nendobj\n');

    var xrOff = off;
    var xr = 'xref\n0 6\n0000000000 65535 f \n';
    for (var i = 1; i <= 5; i++) xr += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    xr += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrOff + '\n%%EOF\n';
    addA(xr);

    var total = chunks.reduce(function (s, c) { return s + c.length; }, 0);
    var res = new Uint8Array(total);
    var p = 0;
    for (var j = 0; j < chunks.length; j++) { res.set(chunks[j], p); p += chunks[j].length; }
    return res;
  }

  // ---------------------------------------------------------------------------
  // 8. Public Export Action (exportConnectionsPdf)
  // ---------------------------------------------------------------------------

  /**
   * Main export action: builds vector PDF (with raster fallback) and downloads.
   * @param {{ button?: HTMLButtonElement | null }} [options]
   * @returns {Promise<void>}
   */
  async function exportConnectionsPdf(options) {
    var App = /** @type {any} */ (window).App || {};
    var btn = (options && options.button) || /** @type {HTMLButtonElement | null} */ (document.getElementById('graphExportPdf'));
    var originalHtml = btn ? btn.innerHTML : '';

    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Exporting…';
    }

    try {
      var liveSvg = /** @type {SVGSVGElement | null} */ (document.querySelector('#knowledgeGraph svg'));
      var focusSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('graphFocus'));
      var statusElem = document.getElementById('graphStatus');

      var focusId = focusSelect ? focusSelect.value : '';
      var notes = (App.state && App.state.notes) || [];
      var focusNote = focusId ? notes.find(function (n) { return n.id === focusId; }) : null;
      var focusTitle = focusNote ? (focusNote.title || focusNote.id) : (focusId ? focusId : '');
      var statusText = statusElem ? statusElem.textContent || '' : '';

      // Determine product name dynamically (respecting branding/rebranding)
      var appTitleElem = document.querySelector('.app-title');
      var appName = (appTitleElem && appTitleElem.textContent && appTitleElem.textContent.trim()) ||
        (document.title ? document.title.split('—')[0].trim() : 'memorai');

      var today = new Date();
      var dateStr = formatDate(today);

      var meta = {
        focusTitle: focusTitle,
        statusText: statusText,
        dateStr: dateStr,
        appName: appName
      };

      /** @type {Uint8Array} */
      var pdfBytes;

      if (!liveSvg) {
        // Empty graph SVG fallback
        var emptyGeom = {
          nodes: [], edges: [],
          bounds: { x: 0, y: 0, width: 800, height: 300, hasNodes: false }
        };
        var emptyPlan = planTiles(emptyGeom.bounds, { hasNodes: false });
        pdfBytes = await buildVectorPdfDocument(emptyGeom, emptyPlan, meta);
      } else {
        try {
          var geom = parseSvgGeometry(liveSvg);
          var plan = planTiles(geom.bounds, { hasNodes: geom.bounds.hasNodes });
          pdfBytes = await buildVectorPdfDocument(geom, plan, meta);
        } catch (vectorError) {
          console.warn('Vector PDF generation failed; falling back to raster pipeline:', vectorError);
          pdfBytes = await generateRasterFallback(liveSvg, meta);
        }
      }

      var pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      var slug = focusTitle ? slugify(focusTitle) : 'all-notes';
      var filename = 'connections-' + slug + '-' + dateStr + '.pdf';

      var downloadUrl = URL.createObjectURL(pdfBlob);
      var a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, 150);
    } catch (error) {
      console.error('PDF export completely failed:', error);
      if (App.toast) {
        App.toast('Could not export PDF. Please try again.', 'error');
      } else {
        alert('Could not export PDF.');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.innerHTML = originalHtml;
        if (App.refreshIcons) {
          App.refreshIcons(btn);
        }
      }
    }
  }

  return {
    exportConnectionsPdf: exportConnectionsPdf,
    buildVectorPdfDocument: buildVectorPdfDocument,
    planTiles: planTiles,
    parseSvgGeometry: parseSvgGeometry,
    parseSvgPath: parseSvgPath,
    convertPathToPdf: convertPathToPdf,
    roundedRectPdf: roundedRectPdf,
    encodeWinAnsiHex: encodeWinAnsiHex,
    sanitizeWinAnsiCodes: sanitizeWinAnsiCodes,
    getTextWidth: getTextWidth,
    wrapText: wrapText,
    slugify: slugify,
    formatDate: formatDate
  };
});

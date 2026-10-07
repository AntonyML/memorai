// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { PROJECT_ROOT } from '../../scripts/site.js';

/** @returns {Promise<any>} */
async function loadExportModule() {
  const code = await readFile(join(PROJECT_ROOT, 'js/connections/export-pdf.js'), 'utf8');
  const context = {
    window: {},
    document: {},
    TextEncoder: TextEncoder,
    Uint8Array: Uint8Array,
    CompressionStream: typeof CompressionStream !== 'undefined' ? CompressionStream : undefined,
    console: console
  };
  context.globalThis = context.window;
  vm.runInNewContext(code, context, { filename: 'export-pdf.js' });
  return context.window.App;
}

test('WinAnsi encoding sanitizes emojis and preserves European diacritics', async () => {
  const mod = await loadExportModule();
  const hex = mod.encodeWinAnsiHex('Hola mundo 🚀 ñandú! Café');
  assert.ok(hex.startsWith('<') && hex.endsWith('>'), 'Must be formatted as PDF hex literal');
  assert.ok(!hex.includes('1F680'), 'Emoji must be stripped');

  // Check character codes
  const codes = mod.sanitizeWinAnsiCodes('Hola ñandú! 🚀');
  assert.ok(codes.includes('ñ'.charCodeAt(0)), 'Must preserve ñ');
  assert.ok(codes.includes('ú'.charCodeAt(0)), 'Must preserve ú');
});

test('AFM metrics correctly calculate text width and wrap lines', async () => {
  const mod = await loadExportModule();
  const w1 = mod.getTextWidth('Hello World', 12, false);
  const w2 = mod.getTextWidth('Hello World', 12, true);
  assert.ok(w1 > 0 && w2 > w1, 'Bold text must be wider than regular text');

  const lines = mod.wrapText('Designing scalable distributed applications with event sourcing', 120, 12, false, 3);
  assert.ok(lines.length > 1, 'Must wrap into multiple lines');
  assert.ok(lines.length <= 3, 'Must respect maxLines parameter');
});

test('SVG path parser elevated quadratic Q to cubic C Bézier curves', async () => {
  const mod = await loadExportModule();
  const d = 'M 10 20 Q 50 100 100 20';
  const dummyTransform = {
    x: (v) => v,
    y: (v) => 800 - v,
    scale: 1
  };
  const pdfOps = mod.convertPathToPdf(d, dummyTransform);
  assert.ok(pdfOps.includes('m'), 'Must contain moveto operator');
  assert.ok(pdfOps.includes('c'), 'Must contain cubic Bézier operator (elevated from Q)');
  assert.ok(!pdfOps.includes('q'), 'PDF does not have quadratic operator q');
});

test('multi-page detail planner activates on small effective title size and caps pages', async () => {
  const mod = await loadExportModule();

  // Small graph: 800x400 fits in single A4 overview page
  const small = mod.planTiles({ x: 0, y: 0, width: 800, height: 400, hasNodes: true });
  assert.equal(small.isMultiPage, false, 'Small graph must be single-page');
  assert.equal(small.tiles.length, 0);

  // Large graph: 5000x4000 exceeds threshold, requires detail pages
  const large = mod.planTiles({ x: 0, y: 0, width: 5000, height: 4000, hasNodes: true });
  assert.equal(large.isMultiPage, true, 'Large graph must trigger multi-page');
  assert.ok(large.tiles.length > 1, 'Must contain multiple detail tiles');
  assert.ok(large.tiles.length < 24, 'Total pages must not exceed MAX_PAGES');
});

test('vector PDF builder produces valid ISO 32000 binary document with xref offsets', async () => {
  const mod = await loadExportModule();
  const geom = {
    nodes: [
      { id: 'note-1', left: 100, top: 100, width: 200, height: 90, titleLines: ['System Architecture'], kind: 'context', isFocused: true, isContext: true },
      { id: 'note-2', left: 400, top: 200, width: 200, height: 90, titleLines: ['Database Design'], kind: 'note', isFocused: false, isContext: false }
    ],
    edges: [
      { type: 'part-of', d: 'M 300 145 Q 350 145 400 245' }
    ],
    bounds: { x: 80, y: 80, width: 540, height: 230, hasNodes: true }
  };
  const plan = mod.planTiles(geom.bounds, { hasNodes: true });
  const meta = {
    focusTitle: 'System Architecture',
    statusText: '2 notes · 1 direct link',
    dateStr: '2026-10-07',
    appName: 'memorai'
  };

  const pdfBytes = await mod.buildVectorPdfDocument(geom, plan, meta);
  assert.ok(pdfBytes instanceof Uint8Array, 'Output must be Uint8Array');

  const latinStr = Buffer.from(pdfBytes).toString('latin1');
  assert.ok(latinStr.startsWith('%PDF-1.4'), 'Header must be %PDF-1.4');
  assert.ok(latinStr.includes('/Type /Catalog'), 'Must include Catalog');
  assert.ok(latinStr.includes('/Type /Pages'), 'Must include Pages');
  assert.ok(latinStr.includes('/Type /Page'), 'Must include Page');
  assert.ok(latinStr.includes('/BaseFont /Helvetica'), 'Must declare Helvetica font');
  assert.ok(latinStr.includes('/BaseFont /Helvetica-Bold'), 'Must declare Helvetica-Bold font');
  assert.ok(latinStr.includes('startxref'), 'Must include startxref');
  assert.ok(latinStr.includes('%%EOF'), 'Must terminate with %%EOF');

  // Validate exact xref byte offset
  const xrefMatch = latinStr.match(/startxref\s+(\d+)/);
  assert.ok(xrefMatch, 'startxref offset must be present');
  const declaredXref = parseInt(xrefMatch[1], 10);
  const actualXref = latinStr.indexOf('xref\n');
  assert.equal(actualXref, declaredXref, 'Declared xref byte offset must match exact file position');
});

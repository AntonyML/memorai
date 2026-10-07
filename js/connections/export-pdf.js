// @ts-check
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    // @ts-ignore
    root.App = root.App || {};
    // @ts-ignore
    root.App.exportConnectionsPdf = factory().exportConnectionsPdf;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  var A4_PT_WIDTH = 595.28;
  var A4_PT_HEIGHT = 841.89;
  var RASTER_SCALE = 2.5;

  /**
   * Generates a safe slug from a note title or identifier.
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
   * Formats a Date object to YYYY-MM-DD.
   * @param {Date} date
   * @returns {string}
   */
  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Measures the unscaled bounding box of all graph nodes and edges.
   * @param {SVGSVGElement} svg
   * @returns {{ x: number, y: number, width: number, height: number, hasNodes: boolean }}
   */
  function calculateSvgBounds(svg) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var hasNodes = false;

    var nodeGroups = svg.querySelectorAll('.graph-node');
    if (nodeGroups.length > 0) {
      hasNodes = true;
      nodeGroups.forEach(function (g) {
        var transform = g.getAttribute('transform') || '';
        var match = transform.match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/);
        if (match) {
          var x = parseFloat(match[1]);
          var y = parseFloat(match[2]);
          var card = g.querySelector('.graph-node-card') || g.querySelector('rect');
          var w = card ? parseFloat(card.getAttribute('width') || '184') : 184;
          var h = card ? parseFloat(card.getAttribute('height') || '60') : 60;
          minX = Math.min(minX, x - w / 2 - 20);
          maxX = Math.max(maxX, x + w / 2 + 20);
          minY = Math.min(minY, y - h / 2 - 20);
          maxY = Math.max(maxY, y + h / 2 + 20);
        }
      });
    }

    if (!isFinite(minX) || !isFinite(minY) || maxX <= minX || maxY <= minY) {
      try {
        if (typeof svg.getBBox === 'function') {
          var bb = svg.getBBox();
          if (bb && bb.width > 0 && bb.height > 0) {
            minX = bb.x;
            minY = bb.y;
            maxX = bb.x + bb.width;
            maxY = bb.y + bb.height;
          }
        }
      } catch (_) {
        // Ignored
      }
    }

    if (!isFinite(minX) || !isFinite(minY) || maxX <= minX || maxY <= minY) {
      var attrW = parseFloat(svg.getAttribute('width') || '800');
      var attrH = parseFloat(svg.getAttribute('height') || '280');
      minX = 0;
      minY = 0;
      maxX = attrW;
      maxY = attrH;
    }

    var padding = 28;
    return {
      x: minX - padding,
      y: minY - padding,
      width: (maxX - minX) + padding * 2,
      height: (maxY - minY) + padding * 2,
      hasNodes: hasNodes
    };
  }

  /**
   * Inlines light theme colors and typography into an SVG clone for print rendering.
   * @param {SVGSVGElement} clone
   * @param {{ x: number, y: number, width: number, height: number }} bounds
   */
  function applyLightStyles(clone, bounds) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', bounds.x + ' ' + bounds.y + ' ' + bounds.width + ' ' + bounds.height);
    clone.setAttribute('width', String(bounds.width));
    clone.setAttribute('height', String(bounds.height));

    // Reset camera transform on scene so graph is rendered unclipped in world coords
    var scene = clone.querySelector('.graph-scene');
    if (scene) scene.removeAttribute('transform');

    var emptyText = clone.querySelector('.graph-empty-text');
    if (emptyText) emptyText.setAttribute('display', 'none');

    var style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = [
      '.knowledge-svg { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #ffffff; }',
      '.graph-node { opacity: 1 !important; }',
      '.graph-connection { opacity: 1 !important; }',
      '.graph-edge { fill: none; stroke: #0969da; stroke-width: 1.6; }',
      '.graph-arrow { fill: #0969da; }',
      '.graph-edge.related { stroke: #64748b; stroke-dasharray: 6 4; }',
      '.graph-arrow.related { fill: #64748b; }',
      '.graph-edge.depends-on { stroke: #d97706; stroke-dasharray: 2 4; }',
      '.graph-arrow.depends-on { fill: #d97706; }',
      '.graph-edge-label-bg { fill: #ffffff; stroke: #e2e8f0; stroke-width: 1; }',
      '.graph-edge-label { fill: #475569; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',
      '.graph-node rect, .graph-node .graph-node-card { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1.5; }',
      '.graph-node.focused rect, .graph-node.focused .graph-node-card { stroke: #0969da; stroke-width: 2.5; fill: #f0f7ff; }',
      '.graph-node.context-node rect, .graph-node.context-node .graph-node-card { stroke: #0284c7; stroke-width: 2; fill: #f8fafc; }',
      '.graph-node.focused.context-node rect, .graph-node.focused.context-node .graph-node-card { stroke: #0969da; stroke-width: 2.5; fill: #f0f7ff; }',
      '.graph-node-title { fill: #0f172a; font-size: 12px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',
      '.graph-node-kind { fill: #64748b; font-size: 10px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',
      '.graph-node-badge-bg { fill: #f1f5f9; stroke: none; }',
      '.graph-node-badge-icon { fill: none; stroke: #475569; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }',
      '.graph-node-focus-ring { visibility: hidden !important; }'
    ].join('\n');
    clone.insertBefore(style, clone.firstChild);

    // Explicit presentation attributes for resilience
    clone.querySelectorAll('.graph-edge').forEach(function (edge) {
      var isRelated = edge.classList.contains('related');
      var isDepends = edge.classList.contains('depends-on');
      edge.setAttribute('fill', 'none');
      edge.setAttribute('stroke-width', '1.6');
      if (isDepends) {
        edge.setAttribute('stroke', '#d97706');
        edge.setAttribute('stroke-dasharray', '2 4');
      } else if (isRelated) {
        edge.setAttribute('stroke', '#64748b');
        edge.setAttribute('stroke-dasharray', '6 4');
      } else {
        edge.setAttribute('stroke', '#0969da');
      }
    });

    clone.querySelectorAll('.graph-arrow').forEach(function (arrow) {
      if (arrow.classList.contains('depends-on')) arrow.setAttribute('fill', '#d97706');
      else if (arrow.classList.contains('related')) arrow.setAttribute('fill', '#64748b');
      else arrow.setAttribute('fill', '#0969da');
    });

    clone.querySelectorAll('.graph-port').forEach(function (port) {
      port.setAttribute('fill', '#ffffff');
      if (port.classList.contains('depends-on')) port.setAttribute('stroke', '#d97706');
      else if (port.classList.contains('related')) port.setAttribute('stroke', '#64748b');
      else port.setAttribute('stroke', '#0969da');
      port.setAttribute('stroke-width', '1.6');
    });

    clone.querySelectorAll('.graph-edge-label-bg').forEach(function (bg) {
      bg.setAttribute('fill', '#ffffff');
      bg.setAttribute('stroke', '#e2e8f0');
      bg.setAttribute('stroke-width', '1');
    });

    clone.querySelectorAll('.graph-edge-label').forEach(function (lbl) {
      lbl.setAttribute('fill', '#475569');
      lbl.setAttribute('font-size', '11px');
      lbl.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif');
    });

    clone.querySelectorAll('.graph-node').forEach(function (node) {
      node.classList.remove('is-muted');
      var card = node.querySelector('.graph-node-card') || node.querySelector('rect');
      var isFocused = node.classList.contains('focused') || node.classList.contains('is-selected');
      var isContext = node.classList.contains('context-node');
      if (card) {
        if (isFocused) {
          card.setAttribute('fill', '#f0f7ff');
          card.setAttribute('stroke', '#0969da');
          card.setAttribute('stroke-width', '2.5');
        } else if (isContext) {
          card.setAttribute('fill', '#f8fafc');
          card.setAttribute('stroke', '#0284c7');
          card.setAttribute('stroke-width', '2');
        } else {
          card.setAttribute('fill', '#ffffff');
          card.setAttribute('stroke', '#cbd5e1');
          card.setAttribute('stroke-width', '1.5');
        }
      }

      var ring = node.querySelector('.graph-node-focus-ring');
      if (ring) ring.setAttribute('visibility', 'hidden');

      var title = node.querySelector('.graph-node-title');
      if (title) {
        title.setAttribute('fill', '#0f172a');
        title.setAttribute('font-weight', '600');
        title.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif');
      }

      var kind = node.querySelector('.graph-node-kind');
      if (kind) {
        kind.setAttribute('fill', '#64748b');
        kind.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif');
      }

      var badgeBg = node.querySelector('.graph-node-badge-bg');
      if (badgeBg) {
        badgeBg.setAttribute('fill', '#f1f5f9');
        badgeBg.setAttribute('stroke', 'none');
      }

      var badgeIcon = node.querySelector('.graph-node-badge-icon');
      if (badgeIcon) {
        badgeIcon.setAttribute('fill', 'none');
        badgeIcon.setAttribute('stroke', '#475569');
        badgeIcon.setAttribute('stroke-width', '1.4');
      }
    });
  }

  /**
   * Loads an SVG clone into an Image object.
   * @param {SVGSVGElement} clone
   * @returns {Promise<HTMLImageElement>}
   */
  function loadSvgImage(clone) {
    var serializer = new XMLSerializer();
    var svgString = serializer.serializeToString(clone);
    var blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();

    return new Promise(function (resolve, reject) {
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to rasterize SVG into image'));
      };
      img.src = url;
    });
  }

  /**
   * Builds an in-memory PDF binary containing a JPEG XObject.
   * @param {Uint8Array} jpegBytes
   * @param {number} imgWidth
   * @param {number} imgHeight
   * @param {number} ptWidth
   * @param {number} ptHeight
   * @returns {Uint8Array}
   */
  function buildPdfDocument(jpegBytes, imgWidth, imgHeight, ptWidth, ptHeight) {
    var enc = new TextEncoder();
    /** @type {Uint8Array[]} */
    var chunks = [];
    var currentOffset = 0;

    /** @param {string} str */
    function pushAscii(str) {
      var b = enc.encode(str);
      chunks.push(b);
      currentOffset += b.length;
      return currentOffset;
    }

    /** @param {Uint8Array} b */
    function pushBinary(b) {
      chunks.push(b);
      currentOffset += b.length;
      return currentOffset;
    }

    pushAscii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    var offsets = [];

    // 1: Catalog
    offsets[1] = currentOffset;
    pushAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // 2: Pages
    offsets[2] = currentOffset;
    pushAscii('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

    // 3: Page
    offsets[3] = currentOffset;
    pushAscii(
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      ptWidth.toFixed(2) + ' ' + ptHeight.toFixed(2) +
      '] /Resources << /XObject << /Img 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'
    );

    // 4: XObject Image
    offsets[4] = currentOffset;
    var imgHeader =
      '4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + imgWidth +
      ' /Height ' + imgHeight +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
      jpegBytes.length + ' >>\nstream\n';
    pushAscii(imgHeader);
    pushBinary(jpegBytes);
    pushAscii('\nendstream\nendobj\n');

    // 5: Contents
    offsets[5] = currentOffset;
    var contentStream =
      'q\n' + ptWidth.toFixed(2) + ' 0 0 ' + ptHeight.toFixed(2) + ' 0 0 cm\n/Img Do\nQ\n';
    var contentBytes = enc.encode(contentStream);
    pushAscii(
      '5 0 obj\n<< /Length ' + contentBytes.length + ' >>\nstream\n' +
      contentStream + 'endstream\nendobj\n'
    );

    // xref table
    var xrefOffset = currentOffset;
    var xrefStr = 'xref\n0 6\n0000000000 65535 f \n';
    for (var i = 1; i <= 5; i++) {
      var off = String(offsets[i]).padStart(10, '0');
      xrefStr += off + ' 00000 n \n';
    }
    xrefStr += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';
    pushAscii(xrefStr);

    var totalLength = chunks.reduce(function (sum, c) { return sum + c.length; }, 0);
    var pdfBytes = new Uint8Array(totalLength);
    var pos = 0;
    for (var j = 0; j < chunks.length; j++) {
      pdfBytes.set(chunks[j], pos);
      pos += chunks[j].length;
    }
    return pdfBytes;
  }

  /**
   * Composes the full A4 canvas including header, graph, and legend.
   * @param {HTMLImageElement | null} graphImg
   * @param {{ width: number, height: number, hasNodes: boolean }} bounds
   * @param {{ focusTitle: string, statusText: string, dateStr: string }} meta
   * @returns {HTMLCanvasElement}
   */
  function composeCanvas(graphImg, bounds, meta) {
    var isLandscape = bounds.hasNodes && (bounds.width / bounds.height) >= 1.15;
    var ptWidth = isLandscape ? A4_PT_HEIGHT : A4_PT_WIDTH;
    var ptHeight = isLandscape ? A4_PT_WIDTH : A4_PT_HEIGHT;

    var canvas = document.createElement('canvas');
    canvas.width = Math.round(ptWidth * RASTER_SCALE);
    canvas.height = Math.round(ptHeight * RASTER_SCALE);
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D canvas context');

    // Fill clean white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(RASTER_SCALE, RASTER_SCALE);

    var margin = 36;
    var sansFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

    // 1. Header
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px ' + sansFont;
    ctx.textAlign = 'left';
    ctx.fillText('Connections', margin, margin + 18);

    var subtitle = meta.focusTitle ? 'Focus: ' + meta.focusTitle : 'All notes';
    if (subtitle.length > 55) subtitle = subtitle.slice(0, 54) + '…';
    ctx.fillStyle = '#475569';
    ctx.font = '500 11px ' + sansFont;
    ctx.fillText(subtitle, margin, margin + 35);

    // Right-aligned header metadata
    ctx.textAlign = 'right';
    ctx.fillStyle = '#475569';
    ctx.font = '500 11px ' + sansFont;
    ctx.fillText(meta.statusText || '0 notes · 0 direct links', ptWidth - margin, margin + 18);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 10px ' + sansFont;
    ctx.fillText('Exported: ' + meta.dateStr, ptWidth - margin, margin + 35);

    // Divider line
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.moveTo(margin, margin + 46);
    ctx.lineTo(ptWidth - margin, margin + 46);
    ctx.stroke();

    // 2. Footer (Legend)
    var footerDividerY = ptHeight - margin - 26;
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.moveTo(margin, footerDividerY);
    ctx.lineTo(ptWidth - margin, footerDividerY);
    ctx.stroke();

    var legendY = ptHeight - margin - 10;
    var legendItems = [
      { text: 'Part of → context', color: '#0969da', dash: [] },
      { text: 'Related to', color: '#64748b', dash: [5, 3] },
      { text: 'Depends on → prerequisite', color: '#d97706', dash: [2, 3] }
    ];

    ctx.font = '10px ' + sansFont;
    var lineWidth = 20;
    var lineGap = 6;
    var itemGap = 18;
    var totalLegendWidth = 0;
    var itemWidths = [];

    for (var i = 0; i < legendItems.length; i++) {
      var w = lineWidth + lineGap + ctx.measureText(legendItems[i].text).width;
      itemWidths.push(w);
      totalLegendWidth += w + (i < legendItems.length - 1 ? itemGap : 0);
    }

    var legendStartX = (ptWidth - totalLegendWidth) / 2;
    var currentX = legendStartX;

    ctx.textAlign = 'left';
    for (var k = 0; k < legendItems.length; k++) {
      var item = legendItems[k];
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(item.dash);
      ctx.beginPath();
      ctx.moveTo(currentX, legendY - 3);
      ctx.lineTo(currentX + lineWidth, legendY - 3);
      ctx.stroke();

      currentX += lineWidth + lineGap;
      ctx.fillStyle = '#475569';
      ctx.fillText(item.text, currentX, legendY);
      currentX += ctx.measureText(item.text).width + itemGap;
    }
    ctx.setLineDash([]);

    // 3. Middle graph area
    var availX = margin;
    var availY = margin + 54;
    var availWidth = ptWidth - margin * 2;
    var availHeight = footerDividerY - availY - 12;

    if (bounds.hasNodes && graphImg) {
      var fitScale = Math.min(availWidth / bounds.width, availHeight / bounds.height);
      var finalScale = Math.min(fitScale, 1.25);
      var drawWidth = bounds.width * finalScale;
      var drawHeight = bounds.height * finalScale;
      var drawX = availX + (availWidth - drawWidth) / 2;
      var drawY = availY + (availHeight - drawHeight) / 2;
      ctx.drawImage(graphImg, drawX, drawY, drawWidth, drawHeight);
    } else {
      // Empty graph placeholder
      var cardW = 340;
      var cardH = 80;
      var cardX = (ptWidth - cardW) / 2;
      var cardY = availY + (availHeight - cardH) / 2;

      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(cardX, cardY, cardW, cardH, 8) : ctx.rect(cardX, cardY, cardW, cardH);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = '#334155';
      ctx.font = '600 13px ' + sansFont;
      ctx.fillText('No connections to display', ptWidth / 2, cardY + 34);

      ctx.fillStyle = '#64748b';
      ctx.font = '400 11px ' + sansFont;
      ctx.fillText('Create notes and connect them through a context to build your map.', ptWidth / 2, cardY + 54);
    }

    ctx.restore();
    // @ts-ignore
    canvas.__ptWidth = ptWidth;
    // @ts-ignore
    canvas.__ptHeight = ptHeight;
    return canvas;
  }

  /**
   * Main export action: serializes graph, composes page, writes PDF and downloads.
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
      var today = new Date();
      var dateStr = formatDate(today);

      var bounds = { x: 0, y: 0, width: 800, height: 280, hasNodes: false };
      /** @type {HTMLImageElement | null} */
      var graphImg = null;

      if (liveSvg) {
        bounds = calculateSvgBounds(liveSvg);
        if (bounds.hasNodes) {
          var clone = /** @type {SVGSVGElement} */ (liveSvg.cloneNode(true));
          applyLightStyles(clone, bounds);
          graphImg = await loadSvgImage(clone);
        }
      }

      var canvas = composeCanvas(graphImg, bounds, {
        focusTitle: focusTitle,
        statusText: statusText,
        dateStr: dateStr
      });

      var jpegBlob = await new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('Failed to encode canvas as JPEG'));
        }, 'image/jpeg', 0.92);
      });

      var jpegBuffer = await jpegBlob.arrayBuffer();
      var jpegBytes = new Uint8Array(jpegBuffer);
      // @ts-ignore
      var ptWidth = canvas.__ptWidth || A4_PT_WIDTH;
      // @ts-ignore
      var ptHeight = canvas.__ptHeight || A4_PT_HEIGHT;

      var pdfBytes = buildPdfDocument(jpegBytes, canvas.width, canvas.height, ptWidth, ptHeight);
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
      console.error('PDF export failed:', error);
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
    buildPdfDocument: buildPdfDocument,
    calculateSvgBounds: calculateSvgBounds,
    slugify: slugify,
    formatDate: formatDate
  };
});

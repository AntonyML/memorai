window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var refs;
  var initialized = false;
  var svgNS = 'http://www.w3.org/2000/svg';
  var typeLabels = { 'part-of': 'Part of', related: 'Related to', 'depends-on': 'Depends on' };
  var backlinkLabels = { 'part-of': 'Contains', related: 'Related to', 'depends-on': 'Required by' };

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function svgElement(tag, attributes, text) {
    var el = document.createElementNS(svgNS, tag);
    Object.keys(attributes || {}).forEach(function (key) { el.setAttribute(key, attributes[key]); });
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function activeNote() {
    return App.state.notes.find(function (note) { return note.id === App.state.activeNoteId; });
  }

  function flushEditor() {
    if (!App.state.activeNoteId) return;
    if (App.state.saveTimeout) {
      clearTimeout(App.state.saveTimeout);
      App.state.saveTimeout = null;
    }
    App.doAutoSave();
  }

  function saveMetadata(updates) {
    flushEditor();
    var note = activeNote();
    if (!note) return;
    App.updateNote(note.id, updates);
    App.renderNotesList();
    App.updateFooterMeta();
    App.renderConnections();
  }

  function navigate(id) {
    if (!App.state.notes.some(function (note) { return note.id === id; })) return;
    if (refs.dialog.open) refs.dialog.close();
    App.openNote(id);
  }

  function option(value, label) {
    var el = element('option', '', label);
    el.value = value;
    return el;
  }

  function sortedNotes() {
    return App.state.notes.slice().sort(function (a, b) {
      return (a.title || a.id).localeCompare(b.title || b.id);
    });
  }

  function populateFocus(value) {
    refs.focus.textContent = '';
    refs.focus.appendChild(option('', 'All notes'));
    sortedNotes().forEach(function (note) {
      refs.focus.appendChild(option(note.id, note.title || 'Untitled (' + note.id + ')'));
    });
    refs.focus.value = value || '';
  }

  function appendConnection(list, connection, explicitLink) {
    var item = element('li', 'connection-item');
    var note = connection.note;
    var target = explicitLink ? explicitLink.target : connection.target || note && note.id;
    var label = note ? note.title || 'Untitled' : 'Missing note: ' + target;
    var button = element('button', 'btn-text connection-note', label);
    button.type = 'button';
    button.disabled = !note;
    if (note) button.addEventListener('click', function () { navigate(note.id); });
    var text = (connection.direction === 'incoming' ? backlinkLabels : typeLabels)[connection.type] || connection.type;
    item.appendChild(element('span', 'connection-type', text));
    item.appendChild(button);
    if (explicitLink) {
      var remove = element('button', 'btn-icon connection-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + text.toLowerCase() + ' link to ' + label);
      remove.title = 'Remove link';
      remove.addEventListener('click', function () {
        var current = activeNote();
        if (!current) return;
        saveMetadata({ links: (current.links || []).filter(function (link) {
          return link.target !== explicitLink.target || link.type !== explicitLink.type;
        }) });
      });
      item.appendChild(remove);
    } else if (connection.direction === 'outgoing') {
      item.appendChild(element('span', 'connection-source', 'In content'));
    }
    list.appendChild(item);
  }

  function emptyList(list, message) {
    if (!list.children.length) list.appendChild(element('li', 'connection-empty', message));
  }

  App.renderConnections = function () {
    if (!initialized || !App.knowledge) return;
    var note = activeNote();
    refs.outgoing.textContent = '';
    refs.incoming.textContent = '';
    var oldTarget = refs.target.value;
    refs.target.textContent = '';
    refs.target.appendChild(option('', 'Choose a note…'));
    sortedNotes().forEach(function (candidate) {
      if (!note || candidate.id === note.id) return;
      refs.target.appendChild(option(candidate.id, candidate.title || 'Untitled (' + candidate.id + ')'));
    });
    refs.target.value = oldTarget;
    if (!refs.target.value) refs.target.value = '';
    refs.add.disabled = !note || refs.target.options.length < 2;
    refs.kind.disabled = !note;
    if (note) {
      refs.kind.value = note.kind || 'note';
      var connections = App.knowledge.getConnections(App.state.notes, note.id);
      var explicitLinks = note.links || [];
      explicitLinks.forEach(function (link) {
        appendConnection(refs.outgoing, {
          note: App.state.notes.find(function (candidate) { return candidate.id === link.target; }),
          direction: 'outgoing', type: link.type
        }, link);
      });
      connections.forEach(function (connection) {
        if (connection.direction === 'incoming') appendConnection(refs.incoming, connection);
        else if (!connection.explicit && !explicitLinks.some(function (link) {
          return connection.note && link.target === connection.note.id && link.type === connection.type;
        })) appendConnection(refs.outgoing, connection);
      });
      App.knowledge.wikiLinks(note.content).forEach(function (link) {
        if (App.state.notes.some(function (candidate) { return candidate.id === link.target; }) ||
          explicitLinks.some(function (explicit) { return explicit.target === link.target; })) return;
        appendConnection(refs.outgoing, { target: link.target, direction: 'outgoing', type: 'related', explicit: false });
      });
      refs.count.textContent = refs.outgoing.children.length + refs.incoming.children.length;
      emptyList(refs.outgoing, 'No outgoing links yet.');
      emptyList(refs.incoming, 'No other notes link here yet.');
    } else {
      refs.count.textContent = '0';
    }
    if (refs.dialog.open) {
      populateFocus(refs.focus.value);
      renderGraph();
    }
  };

  function adjacency(graph) {
    var neighbors = new Map();
    graph.nodes.forEach(function (node) { neighbors.set(node.id, []); });
    graph.edges.forEach(function (edge) {
      if (!neighbors.has(edge.source) || !neighbors.has(edge.target)) return;
      neighbors.get(edge.source).push(edge.target);
      neighbors.get(edge.target).push(edge.source);
    });
    return neighbors;
  }

  function pathsFrom(root, neighbors) {
    var paths = new Map([[root, [root]]]);
    var queue = [root];
    for (var i = 0; i < queue.length; i++) {
      var id = queue[i];
      (neighbors.get(id) || []).forEach(function (next) {
        if (paths.has(next)) return;
        paths.set(next, paths.get(id).concat(next));
        queue.push(next);
      });
    }
    return paths;
  }

  function layoutGraph(graph, focus, neighbors) {
    var positions = new Map();
    var remaining = new Set(graph.nodes.map(function (node) { return node.id; }));
    var top = 24;
    var maxDepth = 0;
    var nodes = graph.nodes.slice().sort(function (a, b) {
      var aContext = a.kind === 'context' ? 1 : 0;
      var bContext = b.kind === 'context' ? 1 : 0;
      return bContext - aContext || (neighbors.get(b.id) || []).length - (neighbors.get(a.id) || []).length ||
        (a.title || a.id).localeCompare(b.title || b.id);
    });
    while (remaining.size) {
      var root = focus && remaining.has(focus) ? focus : nodes.find(function (node) { return remaining.has(node.id); }).id;
      var paths = pathsFrom(root, neighbors);
      var columns = [];
      paths.forEach(function (path, id) {
        if (!remaining.has(id)) return;
        var depth = path.length - 1;
        if (!columns[depth]) columns[depth] = [];
        columns[depth].push(id);
        remaining.delete(id);
        maxDepth = Math.max(maxDepth, depth);
      });
      var height = Math.max(1, Math.max.apply(null, columns.map(function (column) { return column.length; }))) * 94;
      columns.forEach(function (column, depth) {
        column.forEach(function (id, index) {
          positions.set(id, { x: 116 + depth * 274, y: top + height * (index + 0.5) / column.length });
        });
      });
      top += height + 38;
    }
    return { positions: positions, width: Math.max(800, 232 + maxDepth * 274), height: Math.max(280, top) };
  }

  function truncate(text, limit) {
    return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
  }

  function drawGraph(graph, focus, neighbors) {
    var layout = layoutGraph(graph, focus, neighbors);
    var svg = svgElement('svg', {
      width: layout.width, height: layout.height, viewBox: '0 0 ' + layout.width + ' ' + layout.height,
      class: 'knowledge-svg', role: 'group', 'aria-label': 'Connected notes. Select a note to open it.'
    });
    var defs = svgElement('defs');
    ['part-of', 'related', 'depends-on'].forEach(function (type) {
      var marker = svgElement('marker', { id: 'connection-arrow-' + type, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
      marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'graph-arrow ' + type }));
      defs.appendChild(marker);
    });
    svg.appendChild(defs);
    var parallelCounts = new Map();
    graph.edges.forEach(function (edge) {
      var key = [edge.source, edge.target].sort().join('\0');
      parallelCounts.set(key, (parallelCounts.get(key) || 0) + 1);
    });
    graph.edges.forEach(function (edge, index) {
      var source = layout.positions.get(edge.source);
      var target = layout.positions.get(edge.target);
      if (!source || !target) return;
      var dx = target.x - source.x;
      var dy = target.y - source.y;
      var inset = Math.min(dx ? 92 / Math.abs(dx) : Infinity, dy ? 30 / Math.abs(dy) : Infinity);
      if (!isFinite(inset)) return;
      var start = { x: source.x + dx * inset, y: source.y + dy * inset };
      var end = { x: target.x - dx * inset, y: target.y - dy * inset };
      var parallelKey = [edge.source, edge.target].sort().join('\0');
      var offset = parallelCounts.get(parallelKey) > 1 ? (index % 2 ? 18 : -18) : 0;
      var length = Math.sqrt(dx * dx + dy * dy) || 1;
      var mid = { x: (start.x + end.x) / 2 - dy / length * offset, y: (start.y + end.y) / 2 + dx / length * offset };
      svg.appendChild(svgElement('path', {
        d: 'M ' + start.x + ' ' + start.y + ' Q ' + mid.x + ' ' + mid.y + ' ' + end.x + ' ' + end.y,
        class: 'graph-edge ' + edge.type, 'marker-end': 'url(#connection-arrow-' + edge.type + ')', 'aria-hidden': 'true'
      }));
      var label = typeLabels[edge.type] || edge.type;
      var labelWidth = label.length * 6.5 + 12;
      svg.appendChild(svgElement('rect', { x: mid.x - labelWidth / 2, y: mid.y - 11, width: labelWidth, height: 18, rx: 4, class: 'graph-edge-label-bg', 'aria-hidden': 'true' }));
      svg.appendChild(svgElement('text', { x: mid.x, y: mid.y + 2, class: 'graph-edge-label', 'text-anchor': 'middle', 'aria-hidden': 'true' }, label));
    });
    graph.nodes.forEach(function (node) {
      var position = layout.positions.get(node.id);
      var group = svgElement('g', {
        transform: 'translate(' + position.x + ' ' + position.y + ')',
        class: 'graph-node' + (node.id === focus ? ' focused' : '') + (node.kind === 'context' ? ' context-node' : ''),
        tabindex: '0', role: 'link', 'aria-label': 'Open ' + (node.title || 'Untitled') + ', ' + (node.kind || 'note')
      });
      group.appendChild(svgElement('title', {}, (node.title || 'Untitled') + ' · ' + (node.kind || 'note') + '\n' + node.id));
      group.appendChild(svgElement('rect', { x: -92, y: -30, width: 184, height: 60, rx: 10 }));
      group.appendChild(svgElement('text', { x: 0, y: -3, 'text-anchor': 'middle', class: 'graph-node-title' }, truncate(node.title || 'Untitled', 23)));
      group.appendChild(svgElement('text', { x: 0, y: 16, 'text-anchor': 'middle', class: 'graph-node-kind' }, node.kind || 'note'));
      group.addEventListener('click', function () { navigate(node.id); });
      group.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(node.id); }
      });
      svg.appendChild(group);
    });
    refs.graph.appendChild(svg);
  }

  function renderGraph() {
    if (!App.knowledge) return;
    var focus = refs.focus.value;
    refs.depth.disabled = !focus;
    var graph = App.knowledge.getGraph(App.state.notes, { focus: focus || undefined, depth: Number(refs.depth.value) });
    refs.graph.textContent = '';
    refs.graphList.textContent = '';
    refs.status.textContent = graph.nodes.length + ' notes · ' + graph.edges.length + ' direct links';
    if (!graph.nodes.length) {
      refs.graph.appendChild(element('p', 'graph-empty', 'Create notes and connect them through a context to build your map.'));
      return;
    }
    var neighbors = adjacency(graph);
    drawGraph(graph, focus, neighbors);
    var lookup = new Map(graph.nodes.map(function (node) { return [node.id, node]; }));
    var paths = focus ? pathsFrom(focus, neighbors) : new Map();
    graph.nodes.forEach(function (node) {
      var row = element('div', 'graph-note-row');
      var button = element('button', 'btn-text graph-note-button', node.title || 'Untitled');
      button.type = 'button';
      button.addEventListener('click', function () { navigate(node.id); });
      row.appendChild(button);
      var path = paths.get(node.id);
      var description = node.kind || 'note';
      if (path && path.length > 2) {
        description = 'Indirect · via ' + path.slice(1, -1).map(function (id) { return lookup.get(id).title || 'Untitled'; }).join(' → ');
      } else if (focus && node.id !== focus) description = 'Direct connection · ' + description;
      else if (node.id === focus) description = 'Selected note · ' + description;
      row.appendChild(element('span', 'graph-path', description));
      refs.graphList.appendChild(row);
    });
  }

  App.openConnections = function (focus) {
    if (!initialized) return;
    if (!App.openDialog(refs.dialog, refs.close)) return;
    flushEditor();
    populateFocus(focus === undefined ? App.state.activeNoteId : focus);
    renderGraph();
  };

  App.initConnections = function () {
    if (initialized) return;
    refs = {
      dialog: document.getElementById('connectionsDialog'), close: document.getElementById('connectionsClose'),
      focus: document.getElementById('graphFocus'), depth: document.getElementById('graphDepth'),
      graph: document.getElementById('knowledgeGraph'), graphList: document.getElementById('graphNoteList'),
      status: document.getElementById('graphStatus'), kind: document.getElementById('noteKind'),
      target: document.getElementById('connectionTarget'), type: document.getElementById('connectionType'),
      add: document.getElementById('connectionAdd'), count: document.getElementById('connectionsCount'),
      outgoing: document.getElementById('outgoingConnections'), incoming: document.getElementById('incomingConnections')
    };
    if (!refs.dialog) return;
    initialized = true;
    document.getElementById('connectionsToggle').addEventListener('click', function () { App.openConnections(); });
    document.getElementById('noteConnectionsMap').addEventListener('click', function () { App.openConnections(); });
    refs.close.addEventListener('click', function () { refs.dialog.close(); });
    refs.focus.addEventListener('change', renderGraph);
    refs.depth.addEventListener('change', renderGraph);
    refs.kind.addEventListener('change', function () { saveMetadata({ kind: refs.kind.value }); });
    document.getElementById('connectionForm').addEventListener('submit', function (event) {
      event.preventDefault();
      var target = refs.target.value;
      var type = refs.type.value;
      var note = activeNote();
      if (!note || !target || target === note.id || !App.state.notes.some(function (candidate) { return candidate.id === target; })) return;
      var links = note.links || [];
      if (links.some(function (link) { return link.target === target && link.type === type; })) {
        App.toast('This link already exists', 'info');
        return;
      }
      saveMetadata({ links: links.concat({ target: target, type: type }) });
    });
    App.refreshIcons(refs.dialog);
    App.renderConnections();
  };
})();

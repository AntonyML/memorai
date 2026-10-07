(function (root) {
  'use strict';

  var K = {};
  K.KINDS = ['note', 'context', 'project', 'skill', 'decision', 'meeting', 'reference'];
  K.LINK_TYPES = ['part-of', 'related', 'depends-on'];
  var validId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

  function text(value, fallback, name) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string') throw new Error(name + ' must be a string');
    return value;
  }

  K.normalizeNote = function (input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a note object');
    if (typeof input.id !== 'string' || !validId.test(input.id)) throw new Error('Note id must use letters, numbers, hyphens or underscores (max 128)');
    var now = Date.now();
    var note = {
      id: input.id,
      title: text(input.title, '', 'title'),
      content: text(input.content, '', 'content'),
      tags: [],
      pinned: input.pinned === undefined ? false : input.pinned,
      createdAt: input.createdAt === undefined ? now : input.createdAt,
      updatedAt: input.updatedAt === undefined ? now : input.updatedAt,
      kind: input.kind === undefined ? 'note' : input.kind,
      links: []
    };
    if (note.title.length > 500) throw new Error('Title is too long (max 500)');
    if (typeof note.pinned !== 'boolean') throw new Error('pinned must be a boolean');
    ['createdAt', 'updatedAt'].forEach(function (key) {
      if (!Number.isFinite(note[key]) || note[key] <= 0 || note[key] > 8640000000000000) throw new Error(key + ' must be a valid timestamp in milliseconds');
    });
    if (K.KINDS.indexOf(note.kind) === -1) throw new Error('Unknown note kind: ' + note.kind);
    var tags = input.tags === undefined ? [] : input.tags;
    if (!Array.isArray(tags) || tags.length > 100) throw new Error('tags must be an array (max 100)');
    tags.forEach(function (tag) {
      if (typeof tag !== 'string' || tag.length > 100) throw new Error('Each tag must be a string (max 100 characters)');
      tag = tag.trim().toLowerCase();
      if (tag && note.tags.indexOf(tag) === -1) note.tags.push(tag);
    });
    var links = input.links === undefined ? [] : input.links;
    if (!Array.isArray(links) || links.length > 500) throw new Error('links must be an array (max 500)');
    links.forEach(function (link) {
      if (!link || typeof link.target !== 'string' || !validId.test(link.target)) throw new Error('Link target must be a note id');
      if (link.target === note.id) throw new Error('A note cannot link to itself');
      if (K.LINK_TYPES.indexOf(link.type) === -1) throw new Error('Unknown link type: ' + link.type);
      if (!note.links.some(function (item) { return item.target === link.target && item.type === link.type; })) {
        note.links.push({ target: link.target, type: link.type });
      }
    });
    if (input._sha !== undefined) note._sha = text(input._sha, '', '_sha');
    return note;
  };

  K.normalizeNotes = function (notes) {
    if (!Array.isArray(notes) || notes.length > 5000) throw new Error('Expected an array of notes (max 5000)');
    var ids = new Set();
    return notes.map(function (input) {
      var note = K.normalizeNote(input);
      if (ids.has(note.id)) throw new Error('Duplicate note id: ' + note.id);
      ids.add(note.id);
      return note;
    });
  };

  K.validateGraph = function (notes) {
    var normalized = K.normalizeNotes(notes);
    var ids = new Set(normalized.map(function (note) { return note.id; }));
    normalized.forEach(function (note) {
      note.links.forEach(function (link) {
        if (!ids.has(link.target)) throw new Error('Missing link target ' + link.target + ' in ' + note.id);
      });
    });
    return normalized;
  };

  // One format is shared by the browser, the agent CLI and GitHub sync.
  K.noteToMD = function (input) {
    var note = K.normalizeNote(input);
    return '---\n' +
      'id: ' + note.id + '\n' +
      'title: ' + JSON.stringify(note.title) + '\n' +
      'tags: ' + JSON.stringify(note.tags) + '\n' +
      'kind: ' + note.kind + '\n' +
      'links: ' + JSON.stringify(note.links) + '\n' +
      'pinned: ' + note.pinned + '\n' +
      'created: ' + new Date(note.createdAt).toISOString() + '\n' +
      'updated: ' + new Date(note.updatedAt).toISOString() + '\n' +
      '---\n\n' + note.content;
  };

  K.mdToNote = function (md) {
    if (typeof md !== 'string') throw new Error('Expected Markdown text');
    var match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
    if (!match) return null;
    var note = { content: md.slice(match[0].length).replace(/^\r?\n/, '') };
    match[1].split(/\r?\n/).forEach(function (line) {
      var colon = line.indexOf(':');
      if (colon === -1) return;
      var key = line.slice(0, colon).trim();
      var value = line.slice(colon + 1).trim();
      if (['id', 'title', 'kind'].indexOf(key) !== -1) note[key] = value.charAt(0) === '"' ? JSON.parse(value) : value;
      else if (key === 'tags' || key === 'links') {
        // Older memorai exports sometimes used single-quoted tag arrays.
        note[key] = JSON.parse(key === 'tags' && value.indexOf('"') === -1 ? value.replace(/'([^']*)'/g, function (_, tag) { return JSON.stringify(tag); }) : value);
      } else if (key === 'pinned') {
        if (value !== 'true' && value !== 'false') throw new Error('Invalid pinned field');
        note.pinned = value === 'true';
      } else if (key === 'created') note.createdAt = Date.parse(value);
      else if (key === 'updated') note.updatedAt = Date.parse(value);
    });
    if (!note.id) note.id = 'note-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
    return K.normalizeNote(note);
  };

  K.wikiLinks = function (content) {
    var links = [];
    var inFence = false;
    var fence = '';
    var prose = (content || '').split('\n').filter(function (line) {
      var marker = /^\s*(`{3,}|~{3,})/.exec(line);
      if (marker) {
        if (!inFence) { inFence = true; fence = marker[1].charAt(0); }
        else if (marker[1].charAt(0) === fence) inFence = false;
        return false;
      }
      return !inFence;
    }).join('\n').replace(/(`+)[\s\S]*?\1/g, '');
    prose.replace(/\[\[([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})(?:\|([^\]\n]*))?\]\]/g, function (_, id, label) {
      if (!links.some(function (link) { return link.target === id; })) links.push({ target: id, label: label || id });
      return _;
    });
    return links;
  };

  function edgesFor(notes) {
    var ids = new Set(notes.map(function (note) { return note.id; }));
    var edges = [];
    notes.forEach(function (note) {
      (note.links || []).forEach(function (link) {
        if (ids.has(link.target) && link.target !== note.id) edges.push({ source: note.id, target: link.target, type: link.type, explicit: true });
      });
      K.wikiLinks(note.content).forEach(function (link) {
        if (ids.has(link.target) && link.target !== note.id && !edges.some(function (edge) { return edge.source === note.id && edge.target === link.target; })) {
          edges.push({ source: note.id, target: link.target, type: 'related', explicit: false });
        }
      });
    });
    return edges;
  }

  K.getConnections = function (notes, id) {
    var byId = new Map(notes.map(function (note) { return [note.id, note]; }));
    return edgesFor(notes).filter(function (edge) { return edge.source === id || edge.target === id; }).map(function (edge) {
      var outgoing = edge.source === id;
      return { note: byId.get(outgoing ? edge.target : edge.source), direction: outgoing ? 'outgoing' : 'incoming', type: edge.type, explicit: edge.explicit };
    });
  };

  K.getGraph = function (notes, options) {
    options = options || {};
    var edges = edgesFor(notes);
    var included = new Set(notes.map(function (note) { return note.id; }));
    if (options.focus) {
      included = new Set(notes.some(function (note) { return note.id === options.focus; }) ? [options.focus] : []);
      var depth = options.depth === undefined ? 2 : Math.max(0, Math.min(10, options.depth));
      for (var i = 0; i < depth; i++) {
        var next = new Set(included);
        edges.forEach(function (edge) {
          if (included.has(edge.source)) next.add(edge.target);
          if (included.has(edge.target)) next.add(edge.source);
        });
        included = next;
      }
    }
    return {
      nodes: notes.filter(function (note) { return included.has(note.id); }).map(function (note) { return { id: note.id, title: note.title, kind: note.kind || 'note', tags: note.tags || [] }; }),
      edges: edges.filter(function (edge) { return included.has(edge.source) && included.has(edge.target); })
    };
  };

  // Compact baseline markers let the browser detect concurrent edits across reloads.
  K.fingerprint = function (input) {
    var note = K.normalizeNote(input);
    delete note._sha; // GitHub transport bookkeeping is not a content edit.
    var source = JSON.stringify(note);
    var first = 2166136261;
    var second = 5381;
    for (var i = 0; i < source.length; i++) {
      first = Math.imul(first ^ source.charCodeAt(i), 16777619);
      second = Math.imul(second, 33) ^ source.charCodeAt(i);
    }
    return (first >>> 0).toString(16) + '-' + (second >>> 0).toString(16) + '-' + source.length;
  };

  K.baseline = function (notes) {
    var baseline = {};
    notes.forEach(function (note) { baseline[note.id] = K.fingerprint(note); });
    return baseline;
  };

  // Three-way reconciliation: preserve both versions when the same note changes.
  K.reconcileNotes = function (baseline, local, remote) {
    var localMap = new Map(K.normalizeNotes(local).map(function (note) { return [note.id, note]; }));
    var remoteMap = new Map(K.normalizeNotes(remote).map(function (note) { return [note.id, note]; }));
    var ids = new Set(Array.from(localMap.keys()).concat(Array.from(remoteMap.keys()), Object.keys(baseline || {})));
    var result = [];
    var copies = [];
    var conflicts = 0;
    ids.forEach(function (id) {
      var left = localMap.get(id);
      var right = remoteMap.get(id);
      var before = baseline && Object.prototype.hasOwnProperty.call(baseline, id) ? baseline[id] : undefined;
      var leftHash = left && K.fingerprint(left);
      var rightHash = right && K.fingerprint(right);
      if (leftHash === rightHash) { if (left) result.push(Object.assign({}, left, right)); return; }
      if (before !== undefined && leftHash === before) { if (right) result.push(right); return; }
      if (before !== undefined && rightHash === before) { if (left) result.push(left); return; }
      if (!left || !right) {
        // New notes, or an edit concurrent with deletion, survive.
        result.push(left || right);
        if (before !== undefined) conflicts++;
        return;
      }
      result.push(left);
      var copyId = (id.slice(0, 88) + '-conflict-' + rightHash).slice(0, 128);
      if (!localMap.has(copyId) && !remoteMap.has(copyId)) {
        var copyLinks = right.links.filter(function (link) { return link.target !== copyId; });
        copyLinks.push({ target: id, type: 'related' });
        var copy = Object.assign({}, right, { id: copyId, title: (right.title || 'Untitled').slice(0, 470) + ' (conflict copy)', pinned: false, links: copyLinks });
        delete copy._sha;
        copies.push(copy);
      }
      conflicts++;
    });
    result = result.concat(copies);
    // A deletion removes explicit inbound references; prose remains as evidence.
    var surviving = new Set(result.map(function (note) { return note.id; }));
    result.forEach(function (note) {
      var links = note.links.filter(function (link) { return surviving.has(link.target); });
      if (links.length !== note.links.length) { note.links = links; note.updatedAt = Math.max(Date.now(), note.updatedAt + 1); }
    });
    return { notes: result, conflicts: conflicts };
  };

  root.MemoraiKnowledge = K;
  if (root.window) { root.window.App = root.window.App || {}; root.window.App.knowledge = K; }
})(typeof globalThis !== 'undefined' ? globalThis : window);

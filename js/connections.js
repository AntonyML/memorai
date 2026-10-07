window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var refs;
  var initialized = false;
  var controller = null;
  var loading = null;
  var openRequest = 0;
  var typeLabels = { 'part-of': 'Part of', related: 'Related to', 'depends-on': 'Depends on' };
  var backlinkLabels = { 'part-of': 'Contains', related: 'Related to', 'depends-on': 'Required by' };

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
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
    if (controller && refs.dialog.open) controller.update();
  };

  function loadController() {
    if (controller) return Promise.resolve(controller);
    if (!loading) {
      loading = import('./connections/index.js').then(function (module) {
        controller = module.mountConnections(refs.dialog, {
          notes: function () { return App.state.notes; },
          getGraph: function (focus, depth) {
            return App.knowledge.getGraph(App.state.notes, { focus: focus || undefined, depth: depth });
          },
          navigate: navigate
        });
        return controller;
      }).catch(function (error) { loading = null; throw error; });
    }
    return loading;
  }

  App.openConnections = function (focus) {
    if (!initialized) return;
    if (!App.openDialog(refs.dialog, refs.close)) return;
    flushEditor();
    var requestedFocus = focus === undefined ? App.state.activeNoteId : focus;
    var request = ++openRequest;
    if (!controller) refs.status.textContent = 'Loading connections…';
    loadController().then(function (modal) {
      if (refs.dialog.open && request === openRequest) modal.open(requestedFocus || null);
    }).catch(function () {
      if (refs.dialog.open && request === openRequest) refs.status.textContent = 'Unable to load Connections. Close it and try again.';
    });
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
      outgoing: document.getElementById('outgoingConnections'), incoming: document.getElementById('incomingConnections'),
      exportPdf: document.getElementById('graphExportPdf')
    };
    if (!refs.dialog) return;
    initialized = true;
    document.getElementById('connectionsToggle').addEventListener('click', function () { App.openConnections(); });
    document.getElementById('noteConnectionsMap').addEventListener('click', function () { App.openConnections(); });
    refs.close.addEventListener('click', function () { refs.dialog.close(); });
    refs.dialog.addEventListener('close', function () { openRequest++; });
    if (refs.exportPdf) refs.exportPdf.addEventListener('click', function () { if (App.exportConnectionsPdf) App.exportConnectionsPdf({ button: refs.exportPdf }); });
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
    loadController().catch(function () { /* Opening the modal offers a retry. */ });
    App.refreshIcons(refs.dialog);
    App.renderConnections();
  };
})();

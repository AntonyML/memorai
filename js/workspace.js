window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var state = App.state;
  var K = App.knowledge;
  var enabled = false;
  var busy = false;
  var baseline = {};
  var timer;
  var warned = false;
  var unavailable = false;
  var baselineKey = 'memorai_workspace_baseline';

  function status(message) {
    var element = document.getElementById('workspaceStatus');
    if (element) element.textContent = message;
  }

  function readBaseline() {
    try {
      var saved = JSON.parse(localStorage.getItem(baselineKey) || 'null');
      if (saved && saved.origin === location.origin && saved.notes && typeof saved.notes === 'object') baseline = saved.notes;
    } catch (_) { /* Browser notes still provide a recoverable copy. */ }
  }

  function storeBaseline(notes) {
    baseline = K.baseline(notes);
    try { localStorage.setItem(baselineKey, JSON.stringify({ origin: location.origin, notes: baseline })); }
    catch (_) { /* A later restart may preserve a conflicting version as a separate note. */ }
  }

  function cacheNotes() {
    if (App.cacheNotesBackup) App.cacheNotesBackup();
    else {
      try { localStorage.setItem(App.STORE_NOTES, JSON.stringify(state.notes)); }
      catch (_) { App.toast('Browser backup could not be saved. Keep this tab open and export your notes before leaving.', 'error'); }
    }
    if (App.persistOfflineNotes) App.persistOfflineNotes().catch(function () { /* Offline storage reports the failure. */ });
  }

  function flushEditor() {
    if (state.saveTimeout) {
      clearTimeout(state.saveTimeout);
      state.saveTimeout = null;
      App.doAutoSave();
    }
  }

  App.refreshWorkspaceView = function () {
    App.renderNotesList();
    App.updateNoteCount();
    var note = state.notes.find(function (item) { return item.id === state.activeNoteId; });
    if (state.activeNoteId && !note) App.showEmptyEditor();
    else if (note) {
      // Leave caret, scrolling and native undo history alone for unchanged text.
      if (App.dom.noteTitle.value !== note.title) App.dom.noteTitle.value = note.title;
      if (App.dom.noteContent.value !== note.content) App.dom.noteContent.value = note.content;
      if (JSON.stringify(state.currentTags) !== JSON.stringify(note.tags)) App.setActiveTags(note.tags);
      App.updateFooterMeta();
      App.updatePinButton();
      if (state.isPreview) App.switchToPreview(true);
    } else App.routeFromHash();
    if (App.renderConnections) App.renderConnections();
  };

  async function snapshot() {
    var options = { cache: 'no-store', signal: AbortSignal.timeout(5000) };
    var response = await (App.http ? App.http.fetch('/api/notes', options) : fetch('/api/notes', options));
    if (!response.ok) {
      var error = new Error('Workspace request failed (' + response.status + ')');
      error.status = response.status;
      throw error;
    }
    var value = await response.json();
    if (value.version !== 1 || !Number.isInteger(value.revision)) throw new Error('Invalid workspace response');
    value.notes = K.normalizeNotes(value.notes);
    return value;
  }

  function hasChanges(notes, other) {
    return JSON.stringify(K.normalizeNotes(notes)) !== JSON.stringify(K.normalizeNotes(other));
  }

  async function exchange(initial) {
    if (busy) return;
    busy = true;
    try {
      var before = JSON.stringify(K.normalizeNotes(state.notes));
      var remote = await snapshot();
      enabled = true;
      var saved = false;
      for (var attempt = 0; attempt < 3; attempt++) {
        flushEditor();
        var merged = K.reconcileNotes(baseline, state.notes, remote.notes);
        if (!hasChanges(merged.notes, remote.notes)) {
          state.notes = merged.notes;
          storeBaseline(remote.notes);
          cacheNotes();
          saved = true;
          break;
        }
        var sent = K.normalizeNotes(merged.notes);
        state.notes = merged.notes;
        cacheNotes();
        var requestOptions = {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: remote.revision, notes: sent }),
          signal: AbortSignal.timeout(5000)
        };
        var response = await (App.http ? App.http.fetch('/api/notes', requestOptions) : fetch('/api/notes', requestOptions));
        var body = await response.json();
        if (response.status === 409 && body.snapshot) { remote = body.snapshot; continue; }
        if (!response.ok) throw new Error(body.message || body.error || 'Workspace save failed');
        // Edits made while PUT was in flight merge against the submitted snapshot.
        flushEditor();
        state.notes = K.reconcileNotes(K.baseline(sent), state.notes, body.notes).notes;
        storeBaseline(body.notes);
        cacheNotes();
        saved = true;
        if (merged.conflicts) App.toast('Concurrent changes preserved. Review the conflict copies.', 'info');
        break;
      }
      if (!saved) throw new Error('Workspace changed repeatedly; retrying on the next refresh');
      warned = false;
      status('Agent workspace connected');
      if (!initial && before !== JSON.stringify(K.normalizeNotes(state.notes))) App.refreshWorkspaceView();
    } catch (error) {
      if (initial && (error.status === 404 || error.status === 403)) {
        unavailable = true;
        status('Browser storage');
        return;
      }
      status(enabled ? 'Workspace offline — saved in browser' : 'Browser storage');
      if (enabled && !warned) {
        warned = true;
        App.toast('Agent workspace is unavailable. Keep this tab open; saving will retry automatically.', 'error');
      }
    } finally { busy = false; }
  }

  App.initWorkspace = function () {
    readBaseline();
    return exchange(true);
  };

  App.queueWorkspaceSave = function () {
    if (!enabled) return;
    clearTimeout(timer);
    timer = setTimeout(function () { exchange(false); }, 250);
  };

  App.startWorkspacePolling = function () {
    if (unavailable || (!enabled && ['localhost', '127.0.0.1', '[::1]'].indexOf(location.hostname) === -1)) return;
    setInterval(function () { if (!document.hidden) exchange(false); }, 2000);
    window.addEventListener('focus', function () { exchange(false); });
    window.addEventListener('online', function () { exchange(false); });
  };
})();

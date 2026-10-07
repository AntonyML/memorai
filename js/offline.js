window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var state = App.state;
  var K = App.knowledge;
  var metadataKey = 'memorai_offline_baseline';
  var notebook;
  var baseline = {};
  var queuedBaseline = {};
  var queue = Promise.resolve();
  var pending = 0;
  var failure;
  var warned = false;
  var subscribed = false;
  var refreshQueued = false;
  var lifecycleInstalled = false;
  var durableNotes = [];
  var imageFailure;
  var imageQueue = Promise.resolve();
  var imagePending = 0;
  var imageEpoch = 0;
  var dirtyImages = new Map();
  state.offlineImages = state.offlineImages || {};

  App.offlineStatus = { mode: 'starting', pending: 0, error: null };

  function normalize(notes) { return K.validateGraph(K.normalizeNotes(notes)); }
  function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

  function status(mode, error) {
    App.offlineStatus = { mode: mode, pending: pending + imagePending, error: error ? error.message : null };
    var element = document.getElementById('offlineStatus');
    if (element) {
      element.dataset.mode = mode;
      element.textContent = mode === 'rxdb' ? (error ? 'Offline save failed · browser backup' :
        ((pending + imagePending) ? 'Saving offline…' : 'Saved offline · RxDB')) :
        (mode === 'starting' ? 'Opening offline notebook…' : 'Browser backup · RxDB unavailable');
    }
  }

  function saveMetadata(dirty) {
    try { localStorage.setItem(metadataKey, JSON.stringify({ version: 1, notes: baseline, pending: dirty })); }
    catch (_) { /* RxDB remains the primary store; the backup is optional. */ }
  }

  function cache(dirty) {
    if (App.cacheNotesBackup) App.cacheNotesBackup();
    saveMetadata(dirty);
  }

  function warn(error) {
    failure = error;
    status(notebook ? 'rxdb' : 'fallback', error);
    if (!warned) {
      warned = true;
      App.toast('Offline storage is unavailable. Keep this tab open and export your notes before leaving.', 'error');
    }
  }

  function flushEditor() {
    if (state.saveTimeout) {
      clearTimeout(state.saveTimeout);
      state.saveTimeout = null;
      App.doAutoSave();
    }
  }

  async function restoreImages() {
    var epoch = imageEpoch;
    var images = await notebook.readImages();
    if (epoch !== imageEpoch) return [];
    var restored = {};
    images.forEach(function (image) {
      restored[image.filename] = image;
    });
    // Replacing the complete snapshot propagates deletions from another tab.
    // Unsaved local images remain recoverable while their writes are in flight
    // or failed; they are not evidence that a durable image still exists.
    dirtyImages.forEach(function (image) { restored[image.filename] = image; });
    state.offlineImages = restored;
    state.pendingImages = Object.keys(restored).map(function (filename) { return restored[filename]; }).filter(function (image) { return !image.pushed; });
    return images;
  }

  function apply(remote, mergeBaseline, refresh) {
    var before = normalize(state.notes);
    var merged = K.reconcileNotes(mergeBaseline, before, remote);
    state.notes = normalize(merged.notes);
    durableNotes = remote;
    baseline = K.baseline(remote);
    if (!pending) queuedBaseline = K.baseline(remote);
    cache(!same(state.notes, remote));
    if (refresh && !same(before, state.notes) && App.refreshWorkspaceView) App.refreshWorkspaceView();
    if (merged.conflicts) App.toast('Concurrent changes preserved. Review the conflict copies.', 'info');
    return merged;
  }

  App.initOfflineStorage = async function () {
    var metadata;
    try {
      metadata = JSON.parse(localStorage.getItem(metadataKey) || 'null');
      if (metadata && metadata.version === 1 && metadata.notes && typeof metadata.notes === 'object' && !Array.isArray(metadata.notes)) baseline = metadata.notes;
      else metadata = null;
    } catch (_) { metadata = null; }
    try {
      if (!App.libs || !App.libs.openNotebook) throw new Error('Offline database library did not load.');
      notebook = await App.libs.openNotebook();
      var remote = await notebook.read();
      var migratedLegacy = await notebook.hasMigratedLegacy();
      await restoreImages();
      // A pending marker recovers fallback edits AND deletions. Once migrated, a
      // stale localStorage backup cannot resurrect a deleted database note.
      if (!migratedLegacy || (metadata && metadata.pending && App.notesBackupAvailable)) {
        var migrated = !migratedLegacy ? await notebook.migrateLegacy(App.notesBackupAvailable ? baseline : {}, normalize(state.notes)) :
          await notebook.write(baseline, normalize(state.notes));
        state.notes = migrated.notes;
        remote = migrated.notes;
        if (migrated.conflicts) App.toast('Recovered changes preserved. Review the conflict copies.', 'info');
      } else state.notes = remote;
      baseline = K.baseline(remote);
      durableNotes = remote;
      queuedBaseline = K.baseline(remote);
      failure = null;
      status('rxdb');
      cache(false);
      return true;
    } catch (error) {
      if (notebook) { await notebook.close().catch(function () {}); notebook = null; }
      queuedBaseline = baseline;
      saveMetadata(true);
      warn(error);
      return false;
    }
  };

  App.persistOfflineNotes = function () {
    var notes;
    try { notes = normalize(state.notes); }
    catch (error) { warn(error); return Promise.reject(error); }
    if (notebook && !pending && !failure && same(notes, durableNotes)) {
      cache(false);
      return Promise.resolve({ notes: notes, conflicts: 0 });
    }
    var before = queuedBaseline;
    queuedBaseline = K.baseline(notes);
    pending++;
    cache(true);
    status(notebook ? 'rxdb' : 'fallback', failure);
    var released = false;
    var operation = queue.then(async function () {
      if (!notebook) throw failure || new Error('Offline database is unavailable.');
      var saved = await notebook.write(failure ? baseline : before, notes);
      // Preserve input entered while IndexedDB was saving. Flushing the editor
      // enqueues its own snapshot behind this operation.
      flushEditor();
      pending--;
      released = true;
      apply(saved.notes, K.baseline(notes), true);
      failure = null;
      warned = false;
      status('rxdb');
      if (saved.conflicts) App.toast('Concurrent changes preserved. Review the conflict copies.', 'info');
      return saved;
    });
    queue = operation.catch(function (error) {
      if (!released) pending--;
      cache(true);
      warn(error);
    });
    return operation;
  };

  App.flushOfflineNotes = async function () {
    flushEditor();
    // Editor/subscription work can enqueue another save during the await.
    var waiting;
    var waitingImages;
    do { waiting = queue; waitingImages = imageQueue; await waiting; await waitingImages; }
    while (waiting !== queue || waitingImages !== imageQueue);
    if (failure) throw failure;
    if (imageFailure) throw imageFailure;
  };

  App.persistOfflineImage = function (image) {
    var saved = { filename: image.filename, dataUrl: image.dataUrl, name: image.name || 'image', pushed: image.pushed === true };
    imageEpoch++;
    dirtyImages.set(saved.filename, saved);
    state.offlineImages[saved.filename] = saved;
    state.pendingImages = state.pendingImages.filter(function (item) { return item.filename !== saved.filename; });
    if (!saved.pushed) state.pendingImages.push(saved);
    imagePending++;
    status(notebook ? 'rxdb' : 'fallback', imageFailure || failure);
    var operation = imageQueue.then(async function () {
      if (!notebook) throw failure || new Error('Offline database is unavailable.');
      var stored = await notebook.putImage(saved);
      if (dirtyImages.get(stored.filename) === saved) dirtyImages.delete(stored.filename);
      var visible = dirtyImages.get(stored.filename) || stored;
      state.offlineImages[stored.filename] = visible;
      state.pendingImages = state.pendingImages.filter(function (item) { return item.filename !== stored.filename; });
      if (!visible.pushed) state.pendingImages.push(visible);
      if (failure === imageFailure) failure = null;
      imageFailure = null;
      warned = false;
      return stored;
    });
    var completed = operation.finally(function () { imageEpoch++; imagePending--; status(notebook ? 'rxdb' : 'fallback', imageFailure || failure); });
    imageQueue = completed.catch(function (error) { imageFailure = error; warn(error); });
    return completed;
  };

  App.markOfflineImagePushed = function (filename) {
    var image = state.offlineImages[filename];
    if (!image) return Promise.resolve();
    return App.persistOfflineImage({ filename: filename, dataUrl: image.dataUrl, name: image.name, pushed: true });
  };

  App.clearOfflineImages = function () {
    var clearing = new Map(dirtyImages);
    imageEpoch++;
    imagePending++;
    status(notebook ? 'rxdb' : 'fallback', imageFailure || failure);
    var operation = imageQueue.then(async function () {
      if (!notebook) throw failure || new Error('Offline database is unavailable.');
      await notebook.clearImages();
      imageEpoch++;
      clearing.forEach(function (image, filename) { if (dirtyImages.get(filename) === image) dirtyImages.delete(filename); });
      state.offlineImages = {};
      dirtyImages.forEach(function (image) { state.offlineImages[image.filename] = image; });
      state.pendingImages = Array.from(dirtyImages.values()).filter(function (image) { return !image.pushed; });
      if (failure === imageFailure) failure = null;
      imageFailure = null;
      warned = false;
    });
    var completed = operation.finally(function () { imagePending--; status(notebook ? 'rxdb' : 'fallback', imageFailure || failure); });
    imageQueue = completed.catch(function (error) { imageFailure = error; warn(error); });
    return completed;
  };

  App.startOfflineSubscriptions = function () {
    if (!lifecycleInstalled) {
      lifecycleInstalled = true;
      var saveBeforeLeaving = function () { App.flushOfflineNotes().catch(function () {}); };
      if (window.addEventListener) window.addEventListener('pagehide', saveBeforeLeaving);
      if (document.addEventListener) document.addEventListener('visibilitychange', function () { if (document.hidden) saveBeforeLeaving(); });
    }
    if (!notebook || subscribed) return;
    subscribed = true;
    notebook.subscribe(function () {
      if (refreshQueued) return;
      refreshQueued = true;
      var operation = queue.then(async function () {
        refreshQueued = false;
        // Read the newest snapshot after queued writes, not a stale emitted
        // snapshot from an earlier write in this same tab.
        var remote = await notebook.read();
        await imageQueue;
        var beforeImages = JSON.stringify(state.offlineImages);
        await restoreImages();
        flushEditor();
        var merged = apply(remote, baseline, true);
        if (beforeImages !== JSON.stringify(state.offlineImages) && state.isPreview && App.refreshWorkspaceView) App.refreshWorkspaceView();
        status('rxdb', failure);
        if (!same(merged.notes, remote)) App.persistOfflineNotes().catch(function () {});
      });
      queue = operation.catch(function (error) { refreshQueued = false; warn(error); });
    }, warn);
  };
})();

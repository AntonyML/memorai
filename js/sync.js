window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var dom = App.dom;
  var state = App.state;

  function repoAPI(path, method, body) {
    var s = state.settings;
    var url = 'https://api.github.com/repos/' + s.repo + '/contents' + path;
    var headers = {
      Authorization: 'Bearer ' + s.githubToken,
      Accept: 'application/vnd.github+json',
    };
    var opts = { method: method, headers: headers };
    if (body) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return (App.http ? App.http.fetch(url, opts) : fetch(url, opts)).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (e) {
          var error = new Error(e.message || 'HTTP ' + r.status);
          error.status = r.status;
          throw error;
        });
      }
      if (r.status === 204) return null;
      return r.json();
    });
  }

  function btoaSafe(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function atobSafe(str) {
    var binary = atob(str);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  App.noteToMD = App.knowledge.noteToMD;
  App.mdToNote = App.knowledge.mdToNote;

  function showPushResult(result, successMessage) {
    if (result && (result.remoteCheckFailed || result.failedDeletes || result.failedImages)) {
      App.toast('GitHub sync is incomplete. Some remote notes or images could not be updated. Your local notes remain available; try syncing again.', 'error');
    } else {
      App.toast(successMessage, 'success');
    }
  }

  // Core push — mutates state.notes (updates _sha), pushes images. No UI, no toasts.
  App._pushCore = async function () {
    var s = state.settings;
    await App.oneTimeMigration();

    var remoteSHAs = {};
    var remoteFiles = [];
    var report = { remoteCheckFailed: false, failedDeletes: 0, failedImages: 0 };
    try {
      var listing = await repoAPI('/notes?ref=' + s.branch, 'GET');
      if (Array.isArray(listing)) {
        remoteFiles = listing;
        listing.forEach(function (rf) {
          remoteSHAs[rf.name.replace('.md', '')] = rf.sha;
        });
      }
    } catch (e) {
      // A missing notes directory is expected on the first push.
      report.remoteCheckFailed = e.status !== 404;
    }

    for (var i = 0; i < state.notes.length; i++) {
      var note = state.notes[i];
      var md = App.noteToMD(note);
      var path = '/notes/' + note.id + '.md';
      var message = 'Update ' + (note.title || 'Untitled');
      var sha = remoteSHAs[note.id] || note._sha;
      var body = { message: message, content: btoaSafe(md), branch: s.branch };
      if (sha) body.sha = sha;
      var result = await repoAPI(path, 'PUT', body);
      if (result && result.content && result.content.sha) {
        note._sha = result.content.sha;
      }
    }

    // Delete remote notes that no longer exist locally — reuse listing from above
    try {
      if (remoteFiles.length > 0) {
        var localIds = new Set(state.notes.map(function (n) { return n.id; }));
        for (var j = 0; j < remoteFiles.length; j++) {
          var rf = remoteFiles[j];
          if (rf.type !== 'file') continue;
          var remoteId = rf.name.replace('.md', '');
          if (!localIds.has(remoteId)) {
            try {
              await repoAPI('/notes/' + rf.name, 'DELETE', { message: 'Delete ' + remoteId, sha: rf.sha, branch: s.branch });
            } catch (e) {
              report.failedDeletes++;
            }
          }
        }
      }
    } catch (e) {
      report.remoteCheckFailed = true;
    }

    report.failedImages = (await App.pushAllImages()) || 0;
    return report;
  };

  // Core pull — fetches remote notes, merges into state.notes (newer updatedAt wins).
  // Returns { changed: true } if any note was added or updated. No UI, no toasts.
  App._pullCore = async function () {
    var s = state.settings;
    var files = await repoAPI('/notes?ref=' + s.branch, 'GET');
    if (!Array.isArray(files)) return { changed: false };

    var changed = false;
    var incoming = [];

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.type !== 'file') continue;
      var fileData = await repoAPI('/notes/' + f.name + '?ref=' + s.branch, 'GET');
      if (!fileData || !fileData.content) continue;
      var md = atobSafe(fileData.content);
      var note = App.mdToNote(md);
      if (!note) continue;
      note._sha = fileData.sha;
      incoming.push(note);
    }

    // Publish a complete batch: workspace polling must not see links before
    // their newly downloaded targets. Flush typing before comparing timestamps.
    if (state.saveTimeout) App.doAutoSave();
    var idMap = new Map(state.notes.map(function (n) { return [n.id, n]; }));
    incoming.forEach(function (note) {
      var existing = idMap.get(note.id);
      if (existing) {
        if (note.updatedAt > existing.updatedAt) {
          Object.assign(existing, note);
          idMap.set(note.id, existing);
          changed = true;
        }
      } else {
        state.notes.push(note);
        idMap.set(note.id, note);
        changed = true;
      }
    });

    if (changed) {
      state.notes.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      if (App.refreshWorkspaceView) App.refreshWorkspaceView();
    }

    return { changed: changed };
  };

  App.pushAllNotes = async function () {
    var s = state.settings;
    if (!s.githubToken || !s.repo) {
      App.toast('Set GitHub token and repository in Settings', 'error');
      return;
    }
    dom.syncLabel.textContent = 'Pushing...';
    dom.syncBtn.disabled = true;
    try {
      var result = await App._pushCore();
      App.saveNotes();
      dom.syncLabel.textContent = 'Sync with Repo';
      dom.syncBtn.disabled = false;
      showPushResult(result, 'Pushed to repo!');
    } catch (e) {
      dom.syncLabel.textContent = 'Sync with Repo';
      dom.syncBtn.disabled = false;
      App.toast('Could not push to GitHub. Check your connection and repository settings, then try again. Your local notes remain available.', 'error');
    }
  };

  App.pushAllImages = async function () {
    var s = state.settings;
    if (!state.pendingImages.length) return 0;
    var failed = 0;
    // Marking a durable image as uploaded replaces the live pending array.
    var pending = state.pendingImages.slice();
    for (var i = 0; i < pending.length; i++) {
      var img = pending[i];
      if (img._pushed) continue;
      var base64 = img.dataUrl.split(',')[1];
      var path = '/images/' + img.filename;
      var body = { message: 'Add ' + img.filename, content: base64, branch: s.branch };
      try {
        await repoAPI(path, 'PUT', body);
        img._pushed = true;
        if (App.markOfflineImagePushed) await App.markOfflineImagePushed(img.filename);
      } catch (e) {
        failed++;
      }
    }
    state.pendingImages = state.pendingImages.filter(function (img) { return !img._pushed; });
    return failed;
  };

  App.pullAllNotes = async function () {
    var s = state.settings;
    if (!s.githubToken || !s.repo) {
      App.toast('Set GitHub token and repository in Settings', 'error');
      return;
    }
    dom.syncLabel.textContent = 'Pulling...';
    dom.syncBtn.disabled = true;
    try {
      await App._pullCore();
      App.saveNotes();
      App.renderNotesList();
      App.updateNoteCount();
      if (state.activeNoteId && !state.notes.find(function (n) { return n.id === state.activeNoteId; })) {
        App.showEmptyEditor();
      }
      dom.syncLabel.textContent = 'Sync with Repo';
      dom.syncBtn.disabled = false;
      App.toast('Pulled from repo!', 'success');
    } catch (e) {
      dom.syncLabel.textContent = 'Sync with Repo';
      dom.syncBtn.disabled = false;
      App.toast('Could not pull from GitHub. Check your connection and repository settings, then try again. Your local notes remain available.', 'error');
    }
  };

  App.handleSync = async function () {
    var s = state.settings;
    App.saveSettings();
    if (!s.githubToken || !s.repo) {
      App.toast('Set GitHub token and repository in Settings', 'error');
      return;
    }
    dom.syncLabel.textContent = 'Syncing...';
    dom.syncBtn.disabled = true;
    try {
      await App._pullCore();
      var result = await App._pushCore();
      App.saveNotes();
      App.renderNotesList();
      App.updateNoteCount();
      if (state.activeNoteId && !state.notes.find(function (n) { return n.id === state.activeNoteId; })) {
        App.showEmptyEditor();
      }
      dom.syncLabel.textContent = 'Sync with Repo';
      dom.syncBtn.disabled = false;
      showPushResult(result, 'Synced with repo!');
    } catch (e) {
      dom.syncLabel.textContent = 'Sync with Repo';
      dom.syncBtn.disabled = false;
      App.toast('Could not sync with GitHub. Check your connection and repository settings, then try again. Your local notes remain available.', 'error');
    }
  };

  App.silentPull = async function () {
    try {
      return await App._pullCore();
    } catch (e) {
      if (e.status !== 404) {
        App.toast('Background sync is unavailable. Your local notes remain available; try Sync with Repo when your connection is ready.', 'error');
      }
      return { changed: false };
    }
  };

  App.wipeRemoteRepo = async function () {
    var s = state.settings;
    if (!s.repo || !s.githubToken) {
      App.toast('Set GitHub token and repository first', 'error');
      return;
    }
    dom.syncLabel.textContent = 'Wiping...';
    dom.syncBtn.disabled = true;
    var remoteIncomplete = false;
    try {
      var notesList = await repoAPI('/notes?ref=' + s.branch, 'GET');
      if (Array.isArray(notesList)) {
        for (var i = 0; i < notesList.length; i++) {
          var f = notesList[i];
          if (f.type !== 'file') continue;
          try {
            await repoAPI('/notes/' + f.name, 'DELETE', { message: 'Wipe all data', sha: f.sha, branch: s.branch });
          } catch (e) {
            remoteIncomplete = true;
          }
        }
      }
      try {
        var imgList = await repoAPI('/images?ref=' + s.branch, 'GET');
        if (Array.isArray(imgList)) {
          for (var j = 0; j < imgList.length; j++) {
            var fi = imgList[j];
            if (fi.type !== 'file') continue;
            try {
              await repoAPI('/images/' + fi.name, 'DELETE', { message: 'Wipe all data', sha: fi.sha, branch: s.branch });
            } catch (e) {
              remoteIncomplete = true;
            }
          }
        }
      } catch (e) {
        // The images directory is optional; other failures leave cleanup incomplete.
        if (e.status !== 404) remoteIncomplete = true;
      }
      if (App.clearOfflineImages) await App.clearOfflineImages();
      else state.offlineImages = {};
      state.notes = [];
      state.pendingImages = [];
      state.activeNoteId = null;
      state.currentTags = [];
      App.saveNotes();
      if (App.flushOfflineNotes) await App.flushOfflineNotes();
      App.showEmptyEditor();
      App.renderNotesList();
      App.updateNoteCount();
      if (remoteIncomplete) {
        App.toast('Local data cleared, but remote cleanup is incomplete. Check your connection and repository settings, then try wiping again.', 'error');
      } else {
        App.toast('All remote and local data wiped', 'success');
      }
    } catch (e) {
      App.toast('Could not finish wiping data. Some data may remain. Check your connection and local storage, then try again.', 'error');
    } finally {
      dom.syncLabel.textContent = 'Sync with Repo';
      dom.syncBtn.disabled = false;
    }
  };

  App.oneTimeMigration = async function () {
    var migrated = false;
    if (state.saveTimeout) App.doAutoSave();
    var ids = state.notes.map(function (note) { return note.id; });
    try {
      for (var i = 0; i < ids.length; i++) {
        var note = state.notes.find(function (item) { return item.id === ids[i]; });
        if (!note) continue;
        var content = note.content || '';
        var re = /!\[([^\]]*)\]\((data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2})\)/g;
        var match;
        while ((match = re.exec(content)) !== null) {
          var ext = match[3] === 'jpeg' ? 'jpg' : match[3];
          var uniqueId = App.generateId ? App.generateId() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
          var image = { filename: 'img-' + uniqueId + '.' + ext, dataUrl: match[2], name: match[1] || 'image' };
          // Keep the embedded bytes until a durable local image exists.
          if (App.persistOfflineImage) await App.persistOfflineImage(image);
          else state.pendingImages.push(image);
          if (state.saveTimeout) App.doAutoSave();
          var current = state.notes.find(function (item) { return item.id === ids[i]; });
          if (!current || current.content.indexOf(match[0]) === -1) continue;
          var updated = current.content.replace(match[0], '![' + match[1] + '](images/' + image.filename + ')');
          if (App.updateNote) App.updateNote(current.id, { content: updated });
          else {
            current.content = updated;
            current.updatedAt = Math.max(Date.now(), current.updatedAt + 1);
            App.saveNotes();
          }
          migrated = true;
        }
      }
    } finally {
      if (migrated && App.refreshWorkspaceView) App.refreshWorkspaceView();
    }
  };

  App.exportNotes = function () {
    App.doAutoSave();
    var data = JSON.stringify(state.notes, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'memorai-notes-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    App.toast('Notes exported!', 'success');
  };

  App.importNotes = function (file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        App.doAutoSave();
        var idMap = new Map(state.notes.map(function (n) { return [n.id, n]; }));
        imported.forEach(function (n) {
          if (!n.id) n.id = App.generateId();
          if (!Array.isArray(n.tags)) n.tags = [];
          n = App.knowledge.normalizeNote(n);
          var previous = idMap.get(n.id);
          n.updatedAt = Math.max(Date.now(), previous ? previous.updatedAt + 1 : 0, n.updatedAt);
          idMap.set(n.id, n);
        });
        var merged = App.knowledge.validateGraph(Array.from(idMap.values()));
        state.notes = merged;
        state.notes.sort(function (a, b) {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return b.updatedAt - a.updatedAt;
        });
        App.saveNotes();
        App.renderNotesList();
        App.updateNoteCount();
        if (App.refreshWorkspaceView) App.refreshWorkspaceView();
        if (state.activeNoteId && !state.notes.find(function (n) { return n.id === state.activeNoteId; })) {
          App.showEmptyEditor();
        }
        App.toast('Imported ' + imported.length + ' note(s)!', 'success');
      } catch (err) {
        App.toast('Import failed. Choose a valid memorai JSON export with complete note links.', 'error');
      }
    };
    reader.onerror = function () {
      App.toast('Could not read the import file. Choose the file again and retry.', 'error');
    };
    reader.readAsText(file);
  };
})();

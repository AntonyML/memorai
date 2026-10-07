window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var dom = App.dom;
  var state = App.state;

  App.resizeImage = function (file, maxW, maxH) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read the image file.')); };
      reader.onabort = function () { reject(new Error('Image reading was cancelled.')); };
      reader.onload = function (e) {
        var img;
        try { img = new Image(); } catch (error) { reject(error); return; }
        img.onerror = function () { reject(new Error('Could not decode the image file.')); };
        img.onload = function () {
          try {
            var w = img.width;
            var h = img.height;
            if (!w || !h) throw new Error('The image has no usable dimensions.');
            var raster = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/;
            if (w <= maxW && h <= maxH && raster.test(e.target.result)) { resolve(e.target.result); return; }
            var ratio = Math.min(1, maxW / w, maxH / h);
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * ratio));
            canvas.height = Math.max(1, Math.round(h * ratio));
            var ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Image resizing is unavailable.');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Rasterize SVG and unsupported formats; never persist executable SVG markup.
            var mime = /^(?:image\/jpeg|image\/webp)$/.test(file.type) ? file.type : 'image/png';
            var dataUrl = canvas.toDataURL(mime, 0.85);
            if (!raster.test(dataUrl)) throw new Error('Could not encode the resized image.');
            resolve(dataUrl);
          } catch (error) { reject(error); }
        };
        try { img.src = e.target.result; } catch (error) { reject(error); }
      };
      reader.readAsDataURL(file);
    });
  };

  App.handleImageFile = function (file) {
    if (!file || typeof file.type !== 'string' || !/^image\//.test(file.type) || !state.activeNoteId) return false;
    var noteId = state.activeNoteId;
    App.toast('Processing image\u2026', 'info');
    App.resizeImage(file, 1200, 1200).then(async function (dataUrl) {
      var now = new Date();
      var ts = now.getFullYear() +
        ('' + (now.getMonth() + 1)).padStart(2, '0') +
        ('' + now.getDate()).padStart(2, '0') + '-' +
        ('' + now.getHours()).padStart(2, '0') +
        ('' + now.getMinutes()).padStart(2, '0') +
        ('' + now.getSeconds()).padStart(2, '0');
      var mime = dataUrl.match(/^data:image\/(png|jpeg|webp|gif|avif);base64,/);
      if (!mime) throw new Error('The processed image format is unsupported.');
      var ext = mime[1] === 'jpeg' ? 'jpg' : mime[1];
      var filename = ts + '-' + App.generateId() + '.' + ext;
      var name = file.name || 'image';
      name = name.replace(/[\[\]()\r\n]/g, '_');
      var image = { filename: filename, dataUrl: dataUrl, name: name };
      if (App.persistOfflineImage) await App.persistOfflineImage(image);
      else state.pendingImages.push(image);
      var markdown = '\n![' + name + '](images/' + filename + ')\n';
      if (state.activeNoteId === noteId) {
        App.insertMarkdownAtCursor(markdown);
        dom.noteContent.focus();
        App.scheduleSave();
        App.toast('Image inserted', 'success');
      } else {
        var originalNote = state.notes.find(function (note) { return note.id === noteId; });
        if (originalNote) {
          App.updateNote(noteId, { content: originalNote.content + markdown });
          App.renderNotesList();
          App.toast('Image inserted in the original note', 'success');
        } else App.toast('Image saved locally; the original note was deleted', 'info');
      }
    }).catch(function (error) {
      App.toast('Image could not be inserted: ' + (error.message || 'Unknown error'), 'error');
    });
    return true;
  };

  App.insertMarkdownAtCursor = function (text) {
    var ta = dom.noteContent;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var before = ta.value.substring(0, start);
    var after = ta.value.substring(end);
    ta.value = before + text + after;
    ta.selectionStart = ta.selectionEnd = start + text.length;
    ta.focus();
  };

  App.wrapSelection = function (prefix, suffix, placeholder) {
    var ta = dom.noteContent;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    if (start !== end) {
      var selected = ta.value.substring(start, end);
      ta.value = ta.value.substring(0, start) + prefix + selected + suffix + ta.value.substring(end);
      ta.selectionStart = start + prefix.length;
      ta.selectionEnd = start + prefix.length + selected.length;
    } else {
      App.insertMarkdownAtCursor(prefix + placeholder + suffix);
      ta.selectionStart = start + prefix.length;
      ta.selectionEnd = start + prefix.length + placeholder.length;
    }
    ta.focus();
    App.scheduleSave();
  };

  App.insertHeading = function (level) {
    var ta = dom.noteContent;
    var prefix = '';
    for (var i = 0; i < level; i++) prefix += '#';
    prefix += ' ';
    var start = ta.selectionStart;
    var lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart);
    App.insertMarkdownAtCursor(prefix);
    ta.focus();
    App.scheduleSave();
  };

  App.insertLink = function () {
    var ta = dom.noteContent;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var hasSelection = start !== end;
    var selected = hasSelection ? ta.value.substring(start, end) : '';
    var text = hasSelection ? selected : 'link text';
    var placeholder = 'url';
    if (hasSelection) {
      ta.value = ta.value.substring(0, start) + '[' + text + '](' + placeholder + ')' + ta.value.substring(end);
      ta.selectionStart = start + text.length + 3;
      ta.selectionEnd = ta.selectionStart + placeholder.length;
    } else {
      App.insertMarkdownAtCursor('[' + text + '](' + placeholder + ')');
      ta.selectionStart = start + 1;
      ta.selectionEnd = start + 1 + text.length;
    }
    ta.focus();
    App.scheduleSave();
  };

  App.insertCode = function () {
    var ta = dom.noteContent;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var hasSelection = start !== end;
    if (hasSelection) {
      var selected = ta.value.substring(start, end);
      ta.value = ta.value.substring(0, start) + '```\n' + selected + '\n```' + ta.value.substring(end);
      ta.selectionStart = start + 4;
      ta.selectionEnd = start + 4;
    } else {
      App.insertMarkdownAtCursor('```js\n// your code here\n```');
      ta.selectionStart = start + 3;
      ta.selectionEnd = start + 5;
    }
    ta.focus();
    App.scheduleSave();
  };

  App.insertTable = function () {
    var ta = dom.noteContent;
    var start = ta.selectionStart;
    App.insertMarkdownAtCursor('\n| Column 1 | Column 2 |\n|----------|----------|\n|          |          |\n');
    ta.selectionStart = start + 3;
    ta.selectionEnd = start + 11;
    ta.focus();
    App.scheduleSave();
  };

  App.insertList = function (prefix) {
    var ta = dom.noteContent;
    var start = ta.selectionStart;
    var lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    var before = ta.value.substring(0, lineStart);
    var after = ta.value.substring(lineStart);
    ta.value = before + prefix + ' ' + after;
    ta.selectionStart = ta.selectionEnd = lineStart + prefix.length + 1;
    ta.focus();
    App.scheduleSave();
  };
})();

window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var manager = null;
  var refs = {};
  var bindings = [];
  var startedNoteId = null;
  var blockedStart = true;
  var originalTouchAction = '';
  var ignoredTargets = 'a, button, input, textarea, select, option, label, form, pre, code, table, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="slider"], [data-no-note-swipe]';

  function modalOpen() {
    return !!document.querySelector('.modal-overlay:not(.hidden):not([hidden]), dialog[open], [role="dialog"]:not(.hidden):not([hidden]):not([aria-hidden="true"])');
  }

  function previewOpen() {
    return App.state.isPreview && !!App.state.activeNoteId && !modalOpen();
  }

  function selectedText() {
    var selection = window.getSelection && window.getSelection();
    return !!selection && selection.isCollapsed === false;
  }

  function touchAvailable() {
    return !!(window.navigator && window.navigator.maxTouchPoints > 0 ||
      window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  function ignoredTarget(target) {
    var element = target && (target.nodeType === 3 ? target.parentElement : target);
    return !!element && typeof element.closest === 'function' && !!element.closest(ignoredTargets);
  }

  function neighbors() {
    var notes = App.getFilteredNotes();
    var index = notes.findIndex(function (note) { return note.id === App.state.activeNoteId; });
    return {
      notes: notes,
      index: index,
      previous: index > 0 ? notes[index - 1] : null,
      next: index >= 0 && index + 1 < notes.length ? notes[index + 1] : null
    };
  }

  App.navigatePreviewNote = function (direction) {
    if (!previewOpen() || direction !== -1 && direction !== 1) return false;
    var adjacent = neighbors();
    var destination = direction === -1 ? adjacent.previous : adjacent.next;
    if (!destination) return false;
    // openNote flushes pending editor work and retains the current preview mode.
    App.openNote(destination.id);
    App.refreshNoteNavigation();
    return true;
  };

  App.refreshNoteNavigation = function () {
    if (!refs.navigation) return;
    var visible = App.state.isPreview && !!App.state.activeNoteId;
    refs.navigation.hidden = !visible;
    refs.navigation.classList.toggle('hidden', !visible);
    var adjacent = neighbors();
    function updateButton(button, destination, label) {
      if (!button) return;
      button.disabled = !visible || !destination;
      var description = label + (destination ? ': ' + (destination.title || 'Untitled') : '');
      button.title = description;
      button.setAttribute('aria-label', description);
    }
    updateButton(refs.previous, adjacent.previous, 'Previous note');
    updateButton(refs.next, adjacent.next, 'Next note');
    if (refs.hint) {
      refs.hint.textContent = !visible ? '' : adjacent.index < 0
        ? 'Current note is outside this search.'
        : 'Note ' + (adjacent.index + 1) + ' of ' + adjacent.notes.length +
          (manager && touchAvailable() && adjacent.notes.length > 1 ? ' · Swipe left or right to change notes' : '');
    }
  };

  function observeInput(event) {
    if (event.isFirst) {
      startedNoteId = App.state.activeNoteId;
      blockedStart = event.pointerType !== 'touch' || !previewOpen() ||
        ignoredTarget(event.target || event.srcEvent && event.srcEvent.target) || selectedText();
    }
    if (event.pointers && event.pointers.length !== 1) blockedStart = true;
  }

  function swipe(event) {
    if (event.pointerType !== 'touch' || blockedStart || startedNoteId !== App.state.activeNoteId ||
        !previewOpen() || selectedText() || ignoredTarget(event.target || event.srcEvent && event.srcEvent.target)) return;
    // A deliberate horizontal swipe avoids turning diagonal reading/scrolling into navigation.
    if (Math.abs(event.deltaX) < 48 || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 2) return;
    blockedStart = true;
    App.navigatePreviewNote(event.type === 'swipeleft' ? 1 : -1);
  }

  App.destroyGestures = function () {
    bindings.forEach(function (binding) { binding.element.removeEventListener('click', binding.listener); });
    bindings = [];
    if (manager) {
      manager.destroy();
      manager = null;
      if (refs.preview && refs.preview.style) refs.preview.style.touchAction = originalTouchAction;
    }
    if (refs.navigation) {
      refs.navigation.hidden = true;
      refs.navigation.classList.add('hidden');
    }
    startedNoteId = null;
    blockedStart = true;
    refs = {};
  };

  App.initGestures = function () {
    App.destroyGestures();
    var dom = App.dom || {};
    function ref(name, id) { return dom[name] || document.getElementById(id); }
    refs = {
      preview: ref('notePreview', 'notePreview'),
      navigation: ref('noteNavigation', 'noteNavigation'),
      previous: ref('notePreviousBtn', 'notePreviousBtn'),
      next: ref('noteNextBtn', 'noteNextBtn'),
      hint: ref('noteNavigationHint', 'noteNavigationHint')
    };
    function bind(button, direction) {
      if (!button) return;
      var listener = function () { App.navigatePreviewNote(direction); };
      button.addEventListener('click', listener);
      bindings.push({ element: button, listener: listener });
    }
    bind(refs.previous, -1);
    bind(refs.next, 1);
    var Hammer = App.libs && App.libs.Hammer;
    if (Hammer && refs.preview) {
      originalTouchAction = refs.preview.style ? refs.preview.style.touchAction : '';
      try {
        manager = new Hammer.Manager(refs.preview, {
          inputClass: Hammer.TouchInput,
          touchAction: 'auto',
          cssProps: {},
          recognizers: [[Hammer.Swipe, { direction: Hammer.DIRECTION_HORIZONTAL, threshold: 48, velocity: 0.3, pointers: 1 }]]
        });
        manager.on('hammer.input', observeInput);
        manager.on('swipeleft swiperight', swipe);
      } catch (error) {
        if (manager) manager.destroy();
        manager = null;
        if (refs.preview.style) refs.preview.style.touchAction = originalTouchAction;
      }
    }
    App.refreshNoteNavigation();
    return App.destroyGestures;
  };
})();

window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var registered = new WeakSet();
  var toastHome;
  var focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  function visible(element) {
    return element && element.isConnected && !element.disabled && element.getClientRects().length > 0;
  }

  function register(dialog) {
    if (registered.has(dialog)) return;
    registered.add(dialog);
    var opener;
    dialog.addEventListener('close', function () {
      var previous = opener;
      opener = null;
      if (toastHome) (document.querySelector('dialog[open]') || toastHome).appendChild(App.dom.toastContainer);
      // Restore after the caller finishes its action, preserving explicit navigation focus.
      setTimeout(function () {
        if (document.querySelector('dialog[open]')) return;
        var current = document.activeElement;
        if (visible(current) && current !== previous && current !== document.body && !dialog.contains(current)) return;
        var target = visible(previous) ? previous : App.dom.searchInput;
        if (visible(target)) target.focus({ preventScroll: true });
      }, 0);
    });
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') event.stopPropagation();
      if (event.key !== 'Tab') return;
      var controls = Array.from(dialog.querySelectorAll(focusable)).filter(visible);
      if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
      var first = controls[0];
      var last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    });
    dialog.addEventListener('click', function (event) {
      var bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close('cancel');
    });
    return function () { opener = document.activeElement; };
  }

  var remember = new WeakMap();
  App.openDialog = function (dialog, initialFocus) {
    if (!dialog || dialog.open) return false;
    if (document.querySelector('dialog[open], .modal-overlay:not(.hidden):not([hidden])')) return false;
    if (!registered.has(dialog)) remember.set(dialog, register(dialog));
    remember.get(dialog)();
    dialog.returnValue = '';
    dialog.showModal();
    if (App.dom.toastContainer) {
      if (!toastHome) toastHome = App.dom.toastContainer.parentNode;
      dialog.appendChild(App.dom.toastContainer);
    }
    if (initialFocus) initialFocus.focus({ preventScroll: true });
    return true;
  };

  var confirmation;
  var confirmationPending = false;
  App.confirmAction = function (options) {
    if (confirmationPending) return Promise.resolve(false);
    if (!confirmation) {
      confirmation = {
        dialog: document.getElementById('confirmationDialog'),
        title: document.getElementById('confirmationTitle'),
        message: document.getElementById('confirmationMessage'),
        cancel: document.getElementById('confirmationCancel'),
        accept: document.getElementById('confirmationAccept')
      };
      confirmation.cancel.addEventListener('click', function () { confirmation.dialog.close('cancel'); });
      confirmation.accept.addEventListener('click', function () { confirmation.dialog.close('accept'); });
    }
    if (confirmation.dialog.open) return Promise.resolve(false);
    confirmation.title.textContent = options.title;
    confirmation.message.textContent = options.message;
    confirmation.accept.textContent = options.acceptLabel || 'Continue';
    confirmation.accept.classList.toggle('btn-danger-filled', !!options.destructive);
    if (!App.openDialog(confirmation.dialog, confirmation.cancel)) return Promise.resolve(false);
    confirmationPending = true;
    return new Promise(function (resolve) {
      confirmation.dialog.addEventListener('close', function () {
        confirmationPending = false;
        resolve(confirmation.dialog.returnValue === 'accept');
      }, { once: true });
    });
  };
})();

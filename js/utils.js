window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var dom = App.dom;
  var state = App.state;

  App.generateId = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  App.escapeHtml = function (str) {
    var value = str == null ? '' : String(str);
    if (App.libs && App.libs.lodash) return App.libs.lodash.escape(value);
    var entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return value.replace(/[&<>"']/g, function (character) { return entities[character]; });
  };

  function localDateTime(ts) {
    var luxon = App.libs && App.libs.luxon;
    if (!luxon) return null;
    var date = luxon.DateTime.fromJSDate(new Date(ts));
    return date.isValid ? date : null;
  }

  App.formatDate = function (ts) {
    var date = localDateTime(ts);
    if (date) return date.toLocaleString({ month: 'short' }) + ' ' + date.day + ', ' + date.year;
    var d = new Date(ts);
    var month = d.toLocaleDateString(undefined, { month: 'short' });
    var day = d.getDate();
    return month + ' ' + day + ', ' + d.getFullYear();
  };

  App.formatTime = function (ts) {
    var date = localDateTime(ts);
    if (date) {
      return state.settings.timeFormat === '24h'
        ? date.toFormat('HH:mm')
        : date.toLocaleString({ hour: 'numeric', minute: '2-digit', hour12: true });
    }
    var d = new Date(ts);
    if (state.settings.timeFormat === '24h') {
      var h = d.getHours().toString().padStart(2, '0');
      var m = d.getMinutes().toString().padStart(2, '0');
      return h + ':' + m;
    }
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  App.formatDateTime = function (ts) {
    return App.formatDate(ts) + ' ' + App.formatTime(ts);
  };

  App.toast = function (message, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + type;

    var text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);

    if (type === 'error') {
      var btn = document.createElement('button');
      btn.className = 'toast-copy-btn';
      btn.title = 'Copy error';
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        navigator.clipboard.writeText(message).then(function () {
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
          setTimeout(function () {
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
          }, 1500);
        });
      });
      el.appendChild(btn);
    }

    dom.toastContainer.appendChild(el);
    var anime = App.libs && App.libs.anime;
    var reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var animation;
    if (reducedMotion || anime) el.style.animation = 'none';
    if (anime && !reducedMotion) {
      try {
        animation = anime.animate(el, { opacity: [0, 1], translateY: [8, 0], duration: 200, ease: 'outQuad' });
      } catch (_) {
        el.style.opacity = '';
        el.style.transform = '';
      }
    }
    var duration = type === 'error' ? 8000 : 3000;
    setTimeout(function () {
      if (animation) animation.cancel();
      if (reducedMotion) { el.remove(); return; }
      try {
        animation = anime && anime.animate(el, { opacity: 0, translateY: 4, duration: 200, ease: 'inQuad' });
      } catch (_) { animation = null; }
      if (!animation) {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.25s ease';
      }
      // Cleanup is independent of animation callbacks, which may pause in a hidden tab.
      setTimeout(function () {
        if (animation) animation.cancel();
        el.remove();
      }, 250);
    }, duration);
  };
})();

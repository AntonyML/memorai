window.App = window.App || {};
(function () {
  'use strict';
  var App = window.App;
  var refs;
  var initialized = false;
  var chart = null;
  var kindOrder = ['context', 'project', 'skill', 'note', 'decision', 'meeting', 'reference'];
  var kindLabels = { context: 'Context', project: 'Project', skill: 'Skill', note: 'Note', decision: 'Decision', meeting: 'Meeting', reference: 'Reference' };
  var colorVars = ['--accent', '--info', '--success', '--warning', '--accent-hover', '--danger', '--text-muted'];

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function statistics() {
    var graph = App.knowledge.getGraph(App.state.notes);
    var connected = new Set();
    var counts = Object.create(null);
    graph.edges.forEach(function (edge) { connected.add(edge.source); connected.add(edge.target); });
    graph.nodes.forEach(function (note) { var kind = note.kind || 'note'; counts[kind] = (counts[kind] || 0) + 1; });
    var kinds = kindOrder.filter(function (kind) { return counts[kind]; });
    Object.keys(counts).sort().forEach(function (kind) { if (kinds.indexOf(kind) === -1) kinds.push(kind); });
    return {
      total: graph.nodes.length,
      links: graph.edges.length,
      isolated: graph.nodes.filter(function (note) { return !connected.has(note.id); }).length,
      kinds: kinds.map(function (kind) { return { kind: kind, label: kindLabels[kind] || kind, count: counts[kind] }; })
    };
  }

  function destroyChart() {
    if (!chart) return;
    chart.destroy();
    chart = null;
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function palette() {
    var styles = window.getComputedStyle ? window.getComputedStyle(document.documentElement) : null;
    function color(name, fallback) { return styles && styles.getPropertyValue(name).trim() || fallback; }
    return {
      slices: colorVars.map(function (name) { return color(name, '#888888'); }),
      background: color('--bg', '#24273a'),
      text: color('--text', '#cad3f5')
    };
  }

  function metric(value, label) {
    var group = element('div', 'insights-metric');
    group.appendChild(element('strong', 'insights-value', String(value)));
    group.appendChild(element('span', 'insights-label', label));
    refs.summary.appendChild(group);
  }

  App.refreshInsights = function () {
    if (!initialized || !refs.dialog.open || !App.knowledge) return;
    var stats = statistics();
    refs.summary.textContent = '';
    metric(stats.total, 'Notes');
    metric(stats.links, 'Direct links');
    metric(stats.isolated, 'Without connections');
    refs.breakdown.textContent = '';
    stats.kinds.forEach(function (kind) {
      var row = element('tr');
      var heading = element('th', '', kind.label);
      heading.scope = 'row';
      row.appendChild(heading);
      row.appendChild(element('td', '', String(kind.count)));
      refs.breakdown.appendChild(row);
    });
    refs.chart.setAttribute('aria-label', 'Notes by type. ' + stats.kinds.map(function (kind) { return kind.label + ': ' + kind.count; }).join(', '));
    refs.empty.textContent = 'Create your first note to see the notebook statistics.';
    refs.empty.hidden = stats.total !== 0;
    refs.chart.hidden = stats.total === 0;
    if (!stats.total) {
      destroyChart();
      return stats;
    }
    if (!App.libs || typeof App.libs.Chart !== 'function') {
      destroyChart();
      refs.chart.hidden = true;
      refs.empty.hidden = false;
      refs.empty.textContent = 'The chart is unavailable. The table contains all note counts.';
      return stats;
    }
    var colors = palette();
    var data = {
      labels: stats.kinds.map(function (kind) { return kind.label; }),
      datasets: [{
        label: 'Notes',
        data: stats.kinds.map(function (kind) { return kind.count; }),
        backgroundColor: stats.kinds.map(function (_, index) { return colors.slices[index % colors.slices.length]; }),
        borderColor: colors.background,
        borderWidth: 2
      }]
    };
    var options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 250 },
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { titleColor: colors.text, bodyColor: colors.text, backgroundColor: colors.background }
      }
    };
    try {
      if (chart) {
        chart.data = data;
        chart.options = options;
        chart.update('none');
      } else chart = new App.libs.Chart(refs.chart, { type: 'doughnut', data: data, options: options });
    } catch (error) {
      destroyChart();
      // Chart.js may have registered an instance before a canvas error.
      if (typeof App.libs.Chart.getChart === 'function') {
        var partial = App.libs.Chart.getChart(refs.chart);
        if (partial) partial.destroy();
      }
      refs.chart.hidden = true;
      refs.empty.hidden = false;
      refs.empty.textContent = 'The chart is unavailable. The table contains all note counts.';
    }
    return stats;
  };

  App.openInsights = function () {
    if (!initialized) App.initInsights();
    if (!initialized) return;
    if (App.state.saveTimeout && typeof App.doAutoSave === 'function') {
      clearTimeout(App.state.saveTimeout);
      App.state.saveTimeout = null;
      App.doAutoSave();
    }
    if (!refs.dialog.open) refs.dialog.showModal();
    App.refreshInsights();
  };

  App.initInsights = function () {
    if (initialized) return;
    refs = {
      toggle: document.getElementById('insightsToggle'),
      dialog: document.getElementById('insightsDialog'),
      close: document.getElementById('insightsClose'),
      summary: document.getElementById('insightsSummary'),
      chart: document.getElementById('insightsChart'),
      breakdown: document.getElementById('insightsBreakdown'),
      empty: document.getElementById('insightsEmpty')
    };
    if (Object.keys(refs).some(function (key) { return !refs[key]; })) return;
    initialized = true;
    refs.toggle.addEventListener('click', App.openInsights);
    refs.close.addEventListener('click', function () { destroyChart(); refs.dialog.close(); });
    refs.dialog.addEventListener('close', destroyChart);
    refs.dialog.addEventListener('click', function (event) {
      if (event.target === refs.dialog) { destroyChart(); refs.dialog.close(); }
    });
  };
})();

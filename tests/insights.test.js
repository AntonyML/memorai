import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const knowledgeSource = readFileSync(new URL('../js/knowledge.js', import.meta.url), 'utf8');
const insightsSource = readFileSync(new URL('../js/insights.js', import.meta.url), 'utf8');

function notebook({ notes = [], chartAvailable = true, reducedMotion = false, chartFailure = false } = {}) {
  function element(tag = 'div') {
    const listeners = {};
    const node = {
      tag, children: [], attributes: {}, hidden: false, open: false,
      addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(name, value) { this.attributes[name] = value; },
      emit(name, event = {}) { (listeners[name] || []).forEach(callback => callback({ target: this, ...event })); },
      showModal() { this.open = true; },
      close() { this.open = false; this.emit('close'); }
    };
    Object.defineProperty(node, 'textContent', {
      get() { return this.text || ''; },
      set(value) { this.text = value; this.children = []; }
    });
    return node;
  }
  const refs = Object.fromEntries(['insightsToggle', 'insightsDialog', 'insightsClose', 'insightsSummary', 'insightsChart', 'insightsBreakdown', 'insightsEmpty'].map(id => [id, element()]));
  const charts = [];
  const colors = { '--accent': '#b000ff', '--info': '#00aaff', '--success': '#00ff88', '--warning': '#eeaa00', '--bg': '#101010', '--text': '#eeeeee' };
  class Chart {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.type = config.type;
      this.data = config.data;
      this.options = config.options;
      this.updates = [];
      this.destroyed = false;
      charts.push(this);
      if (chartFailure) throw new Error('Canvas is unavailable');
    }
    update(mode) { this.updates.push(mode); }
    destroy() { this.destroyed = true; }
    static getChart(canvas) { return charts.findLast(chart => chart.canvas === canvas && !chart.destroyed); }
  }
  const app = { state: { notes }, libs: chartAvailable ? { Chart } : {} };
  app.openDialog = dialog => {
    if (dialog.open) return false;
    dialog.showModal();
    return true;
  };
  const cleared = [];
  const context = vm.createContext({
    window: { App: app, matchMedia: () => ({ matches: reducedMotion }), getComputedStyle: () => ({ getPropertyValue: name => colors[name] || '' }) },
    document: { getElementById: id => refs[id], createElement: element, documentElement: element() },
    clearTimeout: timer => cleared.push(timer)
  });
  vm.runInContext(knowledgeSource, context, { filename: 'js/knowledge.js' });
  vm.runInContext(insightsSource, context, { filename: 'js/insights.js' });
  app.initInsights();
  return { app, refs, charts, colors, cleared };
}

function connectedNotes() {
  return [
    { id: 'ugp', title: 'UGP', kind: 'context', tags: ['UGP'] },
    { id: 'skill', title: 'UGP skill', kind: 'skill', links: [{ target: 'ugp', type: 'part-of' }], content: 'Duplicate [[ugp]] reference' },
    { id: 'website', title: 'UGP website', kind: 'project', tags: ['UGP'], content: 'See [[ugp|UGP]]. Ignore `[[lonely]]` and [[missing]].' },
    { id: 'lonely', title: 'Independent note', kind: 'note', tags: ['UGP'] }
  ];
}

test('statistics count existing direct and wiki links without tags or transitive edges', () => {
  const notes = connectedNotes();
  const before = JSON.stringify(notes);
  const { app, refs, charts } = notebook({ notes });
  refs.insightsToggle.emit('click');
  const stats = app.refreshInsights();
  expect(stats.total).toBe(4);
  expect(stats.links).toBe(2);
  expect(stats.isolated).toBe(1);
  expect(stats.kinds.map(kind => [kind.label, kind.count])).toEqual([['Context', 1], ['Project', 1], ['Skill', 1], ['Note', 1]]);
  expect(refs.insightsSummary.children.map(metric => metric.children[0].textContent)).toEqual(['4', '2', '1']);
  expect(refs.insightsBreakdown.children).toHaveLength(4);
  expect(refs.insightsBreakdown.children[0].children[0].scope).toBe('row');
  expect(charts[0].type).toBe('doughnut');
  expect(charts[0].data.datasets[0].data).toEqual([1, 1, 1, 1]);
  expect(refs.insightsChart.attributes['aria-label']).toContain('Context: 1');
  expect(JSON.stringify(notes)).toBe(before);
});

test('empty notebooks show zero metrics and never create a misleading chart', () => {
  const { app, refs, charts } = notebook();
  app.openInsights();
  expect(refs.insightsSummary.children.map(metric => metric.children[0].textContent)).toEqual(['0', '0', '0']);
  expect(refs.insightsBreakdown.children).toHaveLength(0);
  expect(refs.insightsEmpty.hidden).toBe(false);
  expect(refs.insightsEmpty.textContent).toContain('first note');
  expect(refs.insightsChart.hidden).toBe(true);
  expect(charts).toHaveLength(0);
});

test('visible updates use current notes and theme colors; closing releases the chart', () => {
  const { app, refs, charts, colors } = notebook({ notes: connectedNotes() });
  app.initInsights();
  app.openInsights();
  expect(charts).toHaveLength(1);
  expect(charts[0].data.datasets[0].backgroundColor[0]).toBe('#b000ff');
  expect(charts[0].options.animation.duration).toBe(250);
  app.state.notes.push({ id: 'second', title: 'Another note', kind: 'note' });
  colors['--accent'] = '#11aa22';
  app.refreshInsights();
  expect(charts).toHaveLength(1);
  expect(charts[0].data.datasets[0].data).toEqual([1, 1, 1, 2]);
  expect(charts[0].data.datasets[0].backgroundColor[0]).toBe('#11aa22');
  expect(charts[0].updates).toEqual(['none']);
  refs.insightsClose.emit('click');
  expect(charts[0].destroyed).toBe(true);
  expect(refs.insightsDialog.open).toBe(false);
  app.state.notes = [];
  app.refreshInsights();
  expect(refs.insightsSummary.children[0].children[0].textContent).toBe('5');
  app.openInsights();
  expect(refs.insightsSummary.children[0].children[0].textContent).toBe('0');
  expect(charts).toHaveLength(1);
  app.state.notes = [{ id: 'new', title: 'New note' }];
  app.refreshInsights();
  expect(charts).toHaveLength(2);
  refs.insightsDialog.close();
  expect(charts[1].destroyed).toBe(true);
});

test('reduced motion disables chart animation and opening flushes pending editor work', () => {
  const { app, charts, cleared } = notebook({ reducedMotion: true });
  app.state.saveTimeout = 42;
  app.doAutoSave = () => app.state.notes.push({ id: 'draft', title: 'Flushed draft' });
  app.openInsights();
  expect(cleared).toEqual([42]);
  expect(app.state.saveTimeout).toBe(null);
  expect(charts[0].options.animation).toBe(false);
  expect(charts[0].data.datasets[0].data).toEqual([1]);
});

test('the accessible counts survive a missing library or failed canvas and partial instances are released', () => {
  for (const configuration of [{ chartAvailable: false }, { chartFailure: true }]) {
    const { app, refs, charts } = notebook({ notes: connectedNotes(), ...configuration });
    app.openInsights();
    expect(refs.insightsChart.hidden).toBe(true);
    expect(refs.insightsEmpty.textContent).toContain('table');
    expect(refs.insightsBreakdown.children).toHaveLength(4);
    expect(refs.insightsSummary.children[1].children[0].textContent).toBe('2');
    expect(charts.every(chart => chart.destroyed)).toBe(true);
  }
});

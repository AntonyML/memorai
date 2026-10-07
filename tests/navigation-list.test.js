import { expect, test } from 'bun:test';
import vm from 'node:vm';

const sources = await Promise.all(['notes', 'ui'].map(name => Bun.file(new URL(`../js/${name}.js`, import.meta.url)).text()));

function browser() {
  const focused = [];
  const app = {
    state: { notes: [], activeNoteId: null, settings: { sortBy: 'title' }, isPreview: false, saveTimeout: null },
    dom: {
      searchInput: { value: '' }, noteTitle: { value: '', focus: () => focused.push('title') },
      noteContent: { value: '' }, notePreview: { focus: () => focused.push('preview') },
      editorEmpty: { classList: { add() {} } }, editorContent: { classList: { remove() {} } }
    }
  };
  const context = vm.createContext({ window: { App: app, innerWidth: 1200 }, history: { replaceState() {} } });
  sources.forEach(source => vm.runInContext(source, context));
  for (const name of ['doAutoSave', 'setActiveTags', 'updateFooterMeta', 'switchToPreview', 'switchToEdit', 'updatePinButton', 'renderNotesList']) app[name] = () => {};
  return { app, focused };
}

test('preview navigation shares sidebar search and pinned sort without mutating notebook order', () => {
  const { app } = browser();
  app.state.notes = [
    { id: 'web', title: 'UGP Web', content: '', tags: [], pinned: false, updatedAt: 30, createdAt: 1 },
    { id: 'context', title: 'Z Context', content: 'UGP belongs here', tags: [], pinned: true, updatedAt: 10, createdAt: 3 },
    { id: 'skill', title: 'A Skill', content: '', tags: ['ugp'], pinned: false, updatedAt: 20, createdAt: 2 },
    { id: 'other', title: 'Unrelated', content: '', tags: [], pinned: false, updatedAt: 40, createdAt: 4 }
  ];
  const originalOrder = app.state.notes.map(note => note.id);
  app.dom.searchInput.value = ' UGP ';
  expect(app.getFilteredNotes().map(note => note.id)).toEqual(['context', 'skill', 'web']);
  app.state.settings.sortBy = 'modified';
  expect(app.getFilteredNotes().map(note => note.id)).toEqual(['context', 'web', 'skill']);
  app.dom.searchInput.value = 'missing';
  expect(app.getFilteredNotes()).toHaveLength(0);
  expect(app.state.notes.map(note => note.id)).toEqual(originalOrder);
});

test('opening a preview note focuses the reading surface instead of opening the title keyboard', () => {
  const { app, focused } = browser();
  app.state.notes = [{ id: 'one', title: 'Reading', content: 'Text', tags: [] }];
  app.state.isPreview = true;
  app.openNote('one');
  expect(focused).toEqual(['preview']);
  app.state.isPreview = false;
  app.openNote('one');
  expect(focused).toEqual(['preview', 'title']);
});

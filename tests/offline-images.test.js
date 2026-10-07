import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const imageSource = readFileSync(new URL('../js/image.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const png = 'data:image/png;base64,aGVsbG8=';
const jpeg = 'data:image/jpeg;base64,aGVsbG8=';
const settle = async () => { for (let index = 0; index < 3; index++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function browser(overrides = {}) {
  const toasts = [];
  const images = [];
  const saves = [];
  const updates = [];
  let nextId = 0;
  const app = {
    state: { activeNoteId: 'original', notes: [{ id: 'original', content: 'Original' }, { id: 'other', content: 'Other' }], settings: {}, pendingImages: [], offlineImages: {} },
    dom: { noteContent: { value: '', selectionStart: 0, selectionEnd: 0, focus() {} } },
    generateId: () => 'image' + (++nextId),
    toast: (message, type) => toasts.push({ message, type }),
    updateNote: (id, changes) => { updates.push({ id, changes }); Object.assign(app.state.notes.find(note => note.id === id), changes); },
    persistOfflineImage: async image => {
      images.push({ ...image, editorAtSave: app.dom.noteContent.value });
      app.state.offlineImages[image.filename] = { ...image, pushed: false };
      app.state.pendingImages.push(image);
    }
  };
  const context = vm.createContext({ window: { App: app }, ...overrides });
  vm.runInContext(imageSource, context, { filename: 'js/image.js' });
  vm.runInContext(uiSource, context, { filename: 'js/ui.js' });
  app.scheduleSave = () => saves.push(app.dom.noteContent.value);
  app.renderNotesList = () => {};
  return { app, toasts, images, saves, updates };
}

test('inserted images persist before Markdown and receive distinct filenames within one second', async () => {
  const env = browser();
  env.app.resizeImage = async () => png;
  expect(env.app.handleImageFile({ type: 'image/png', name: 'Diagram[1].png' })).toBe(true);
  expect(env.app.handleImageFile({ type: 'image/png', name: 'Diagram[2].png' })).toBe(true);
  await settle();
  expect(env.images).toHaveLength(2);
  expect(env.images[0].filename).not.toBe(env.images[1].filename);
  expect(env.images[0].filename).toMatch(/^\d{8}-\d{6}-image1\.png$/);
  expect(env.images.every(image => image.editorAtSave === '')).toBe(true);
  for (const image of env.images) {
    expect(env.app.dom.noteContent.value).toContain(`images/${image.filename}`);
    expect(env.app.state.offlineImages[image.filename].dataUrl).toBe(png);
  }
  expect(env.saves).toHaveLength(2);
});

test('image filenames match the encoded MIME rather than the input file type', async () => {
  const env = browser();
  env.app.resizeImage = async () => jpeg;
  env.app.handleImageFile({ type: 'image/png', name: 'Converted.png' });
  await settle();
  expect(env.images[0].filename.endsWith('.jpg')).toBe(true);
});

test('failed image persistence retains the memory copy without inserting a broken reference', async () => {
  const env = browser();
  env.app.resizeImage = async () => png;
  env.app.persistOfflineImage = async image => {
    env.app.state.offlineImages[image.filename] = image;
    throw new Error('Storage quota exceeded');
  };
  env.app.handleImageFile({ type: 'image/png', name: 'Diagram.png' });
  await settle();
  expect(Object.values(env.app.state.offlineImages)).toHaveLength(1);
  expect(env.app.dom.noteContent.value).toBe('');
  expect(env.saves).toHaveLength(0);
  expect(env.toasts.at(-1)).toEqual({ message: 'Image could not be inserted: Storage quota exceeded', type: 'error' });
});

test('switching notes while an image is processing inserts into the original note only', async () => {
  const env = browser();
  const resized = deferred();
  env.app.resizeImage = () => resized.promise;
  env.app.handleImageFile({ type: 'image/png', name: 'Diagram.png' });
  env.app.state.activeNoteId = 'other';
  env.app.dom.noteContent.value = 'Other draft';
  resized.resolve(png);
  await settle();
  expect(env.updates).toHaveLength(1);
  expect(env.updates[0].id).toBe('original');
  expect(env.app.state.notes[0].content).toContain('images/' + env.images[0].filename);
  expect(env.app.state.notes[1].content).toBe('Other');
  expect(env.app.dom.noteContent.value).toBe('Other draft');
  expect(env.saves).toHaveLength(0);
});

test('image processing failures are reported without changing notes', async () => {
  const env = browser();
  env.app.resizeImage = async () => { throw new Error('Could not decode the image file.'); };
  env.app.handleImageFile({ type: 'image/png', name: 'Broken.png' });
  await settle();
  expect(env.images).toHaveLength(0);
  expect(env.app.dom.noteContent.value).toBe('');
  expect(env.toasts.at(-1).type).toBe('error');
  expect(env.toasts.at(-1).message).toContain('Could not decode');
});

test('preview prefers cached raster images after upload and falls back for remote files', () => {
  const { app } = browser();
  app.state.settings = { repo: 'example/notes', branch: 'main' };
  app.state.offlineImages['local.png'] = { filename: 'local.png', dataUrl: png, pushed: true };
  app.state.offlineImages['unsafe.svg'] = { dataUrl: 'data:image/svg+xml;base64,aGVsbG8=' };
  expect(app.rewriteImageURLs('<img src="images/local.png">')).toBe(`<img src="${png}">`);
  expect(app.rewriteImageURLs('<img src="images/remote.png">')).toBe('<img src="https://raw.githubusercontent.com/example/notes/main/images/remote.png">');
  expect(app.rewriteImageURLs('<img src="images/unsafe.svg">')).toContain('https://raw.githubusercontent.com/');
  app.state.settings.repo = '';
  expect(app.rewriteImageURLs('<img src="images/local.png">')).toBe(`<img src="${png}">`);
  expect(app.rewriteImageURLs('<img src="images/remote.png">')).toBe('<img src="images/remote.png">');
});

test('FileReader errors reject image resizing instead of leaving a hanging operation', async () => {
  class Reader { readAsDataURL() { this.onerror(); } }
  const { app } = browser({ FileReader: Reader });
  await expect(app.resizeImage({ type: 'image/png' }, 1200, 1200)).rejects.toThrow('Could not read');
});

test('decode and canvas errors reject image resizing', async () => {
  class Reader { readAsDataURL() { this.onload({ target: { result: png } }); } }
  class BrokenImage { set src(value) { this.onerror(); } }
  const decode = browser({ FileReader: Reader, Image: BrokenImage });
  await expect(decode.app.resizeImage({ type: 'image/png' }, 1200, 1200)).rejects.toThrow('Could not decode');
  class LargeImage { constructor() { this.width = 2000; this.height = 2000; } set src(value) { this.onload(); } }
  const canvas = browser({ FileReader: Reader, Image: LargeImage, document: { createElement: () => ({ getContext: () => null }) } });
  await expect(canvas.app.resizeImage({ type: 'image/png' }, 1200, 1200)).rejects.toThrow('Image resizing is unavailable');
});

import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';

const id = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' };
const timestamp = { type: 'number', minimum: 1, maximum: 8640000000000000 };
const noteSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id, title: { type: 'string', maxLength: 500 }, content: { type: 'string' },
    tags: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 100 } },
    pinned: { type: 'boolean' }, createdAt: timestamp, updatedAt: timestamp,
    kind: { type: 'string', enum: ['note', 'context', 'project', 'skill', 'decision', 'meeting', 'reference'] },
    links: {
      type: 'array', maxItems: 500,
      items: {
        type: 'object', additionalProperties: false,
        properties: { target: id, type: { type: 'string', enum: ['part-of', 'related', 'depends-on'] } },
        required: ['target', 'type']
      }
    },
    _sha: { type: 'string' }
  },
  required: ['id', 'title', 'content', 'tags', 'pinned', 'createdAt', 'updatedAt', 'kind', 'links']
};

// One document commits the entire graph together. Publishing each note separately
// would temporarily expose a relationship whose target has not yet been written.
export const notebookSchema = {
  title: 'memorai offline notebook', version: 0, primaryKey: 'id', type: 'object',
  properties: {
    id: { type: 'string', maxLength: 20, enum: ['notes'] },
    notes: { type: 'array', maxItems: 5000, items: noteSchema },
    legacyMigrated: { type: 'boolean' }
  },
  required: ['id', 'notes'], additionalProperties: false
};

const imageSchema = {
  title: 'memorai offline image', version: 0, primaryKey: 'id', type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$' },
    dataUrl: { type: 'string', maxLength: 16 * 1024 * 1024, pattern: '^data:image/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$' },
    name: { type: 'string', maxLength: 500 }, pushed: { type: 'boolean' }
  },
  required: ['id', 'dataUrl', 'name', 'pushed'], additionalProperties: false
};

function normalizeImage(image) {
  if (!image || typeof image.filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(image.filename) || image.filename.includes('..')) throw new Error('Invalid offline image filename.');
  if (typeof image.dataUrl !== 'string' || image.dataUrl.length > 16 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) throw new Error('Expected a base64 raster image (PNG, JPEG, WebP, GIF or AVIF).');
  const name = image.name === undefined ? 'image' : image.name;
  if (typeof name !== 'string' || name.length > 500) throw new Error('Invalid offline image name.');
  if (image.pushed !== undefined && typeof image.pushed !== 'boolean') throw new Error('Invalid offline image upload status.');
  return { id: image.filename, dataUrl: image.dataUrl, name, pushed: image.pushed === true };
}

const publicImage = image => ({ filename: image.id, dataUrl: image.dataUrl, name: image.name, pushed: image.pushed });

export async function openNotebook(options = {}) {
  const K = options.knowledge || globalThis.MemoraiKnowledge;
  if (!K?.normalizeNotes || !K?.validateGraph || !K?.reconcileNotes) throw new Error('The knowledge interface must load before the notebook.');
  const normalize = notes => K.validateGraph(K.normalizeNotes(notes));
  const database = await createRxDatabase({
    name: options.name || 'memorai-notebook',
    storage: wrappedValidateAjvStorage({ storage: options.storage || getRxStorageDexie() }),
    multiInstance: options.multiInstance !== false
  });
  try {
    const collections = await database.addCollections({ notebooks: { schema: notebookSchema }, images: { schema: imageSchema } });
    const collection = collections.notebooks;
    let document = await collection.findOne('notes').exec();
    if (!document) {
      try { document = await collection.insert({ id: 'notes', notes: [], legacyMigrated: false }); }
      catch (error) {
        // Another tab may have inserted the singleton after our read.
        document = await collection.findOne('notes').exec();
        if (!document) throw error;
      }
    }
    normalize(document.toJSON().notes);
    return {
      async read() {
        const latest = await collection.findOne('notes').exec();
        if (!latest) throw new Error('The offline notebook document is missing.');
        return normalize(latest.toJSON().notes);
      },
      async write(baseline, notes) {
        const local = normalize(notes);
        if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) throw new Error('Expected notebook baseline fingerprints.');
        const current = await collection.findOne('notes').exec();
        if (!current) throw new Error('The offline notebook document is missing.');
        const currentNotes = normalize(current.toJSON().notes);
        const preview = K.reconcileNotes(baseline, local, currentNotes);
        if (JSON.stringify(preview.notes) === JSON.stringify(currentNotes)) return { notes: currentNotes, conflicts: preview.conflicts };
        document = current;
        let conflicts = 0;
        const latest = await document.incrementalModify(current => {
          // RxDB retries this modifier against the current revision on conflicts.
          const merged = K.reconcileNotes(baseline, local, normalize(current.notes));
          conflicts = merged.conflicts;
          return { ...current, notes: normalize(merged.notes) };
        });
        document = latest;
        return { notes: normalize(latest.toJSON().notes), conflicts };
      },
      async hasMigratedLegacy() {
        const latest = await collection.findOne('notes').exec();
        return latest?.toJSON().legacyMigrated === true;
      },
      async migrateLegacy(baseline, notes) {
        const local = normalize(notes);
        let conflicts = 0;
        const latest = await document.incrementalModify(current => {
          if (current.legacyMigrated) return current;
          const merged = K.reconcileNotes(baseline, local, normalize(current.notes));
          conflicts = merged.conflicts;
          return { ...current, notes: normalize(merged.notes), legacyMigrated: true };
        });
        document = latest;
        return { notes: normalize(latest.toJSON().notes), conflicts };
      },
      subscribe(listener, onError) {
        let latestNotes = normalize(document.toJSON().notes);
        const subscription = collection.findOne('notes').$.subscribe({
          next: latest => {
            if (!latest) return;
            try { latestNotes = normalize(latest.toJSON().notes); listener(latestNotes); }
            catch (error) { if (onError) onError(error); }
          },
          error: error => { if (onError) onError(error); }
        });
        const imageSubscription = collections.images.$.subscribe({
          next: () => { try { listener(latestNotes); } catch (error) { if (onError) onError(error); } },
          error: error => { if (onError) onError(error); }
        });
        return () => { subscription.unsubscribe(); imageSubscription.unsubscribe(); };
      },
      async putImage(image) {
        const saved = await collections.images.incrementalUpsert(normalizeImage(image));
        return publicImage(saved.toJSON());
      },
      async readImages() {
        const images = await collections.images.find().exec();
        return images.map(image => publicImage(image.toJSON()));
      },
      async clearImages() {
        const images = await collections.images.find().exec();
        if (!images.length) return;
        const removed = await collections.images.bulkRemove(images.map(image => image.primary));
        if (removed.error.length) throw new Error('Some offline images could not be deleted.');
      },
      close: () => database.close()
    };
  } catch (error) {
    // Never remove the database to make a failed upgrade appear successful.
    await database.close();
    throw error;
  }
}

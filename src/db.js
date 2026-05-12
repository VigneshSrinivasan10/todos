import PouchDB from 'pouchdb-browser';
import PouchDBFind from 'pouchdb-find';

PouchDB.plugin(PouchDBFind);

export const db = new PouchDB('todos');

let indexed = false;
export async function initDb() {
  if (indexed) return;
  await db.createIndex({ index: { fields: ['type', 'done', 'inbox'] } });
  await db.createIndex({ index: { fields: ['type', 'done', 'due'] } });
  indexed = true;
}

// ---- Optional CouchDB sync ---------------------------------------------------

const remoteUrl = import.meta.env.VITE_COUCH_URL;
let syncHandler = null;

export function startSync({ onChange, onError } = {}) {
  if (!remoteUrl) return null;
  const user = import.meta.env.VITE_COUCH_USER;
  const pass = import.meta.env.VITE_COUCH_PASS;
  const remote = new PouchDB(remoteUrl, user ? { auth: { username: user, password: pass } } : undefined);
  syncHandler = db
    .sync(remote, { live: true, retry: true })
    .on('change', (info) => onChange?.(info))
    .on('error', (err) => onError?.(err))
    .on('denied', (err) => onError?.(err));
  return syncHandler;
}

export function stopSync() {
  if (syncHandler) {
    syncHandler.cancel();
    syncHandler = null;
  }
}

// ---- CRUD --------------------------------------------------------------------

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const now = () => new Date().toISOString();

export async function createTask({ title, notes = '', tags = [], source = null, inbox = false, due = null }) {
  const doc = {
    _id: `task:${uuid()}`,
    type: 'task',
    title,
    notes,
    done: false,
    inbox,
    deleted: false,
    tags,
    source,
    due,
    created: now(),
    updated: now()
  };
  const res = await db.put(doc);
  return { ...doc, _rev: res.rev };
}

export async function updateTask(task, patch) {
  const next = { ...task, ...patch, updated: now() };
  const res = await db.put(next);
  return { ...next, _rev: res.rev };
}

export async function deleteTask(task) {
  return updateTask(task, { deleted: true, deletedAt: now() });
}

export async function restoreTask(task) {
  return updateTask(task, { deleted: false, deletedAt: null });
}

export async function purgeTask(task) {
  return db.remove(task);
}

// Load every task once; views are computed in-memory. Cheap for personal use,
// avoids per-view index bookkeeping, and makes search/counts trivial.
export async function getAllTasks() {
  const res = await db.allDocs({
    include_docs: true,
    startkey: 'task:',
    endkey: 'task:￰'
  });
  return res.rows.map((r) => r.doc);
}

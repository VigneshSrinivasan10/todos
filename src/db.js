import PouchDB from 'pouchdb-browser';
import PouchDBFind from 'pouchdb-find';

PouchDB.plugin(PouchDBFind);

export const db = new PouchDB('todos');

// Indexes for the views — only do this once per app load.
let indexed = false;
export async function initDb() {
  if (indexed) return;
  await db.createIndex({ index: { fields: ['type', 'done', 'inbox'] } });
  await db.createIndex({ index: { fields: ['type', 'done', 'due'] } });
  indexed = true;
}

// ---- Optional CouchDB sync ---------------------------------------------------
// Configure via `.env.local`:
//   VITE_COUCH_URL=http://ryzen.tailnet:5984/todos
//   VITE_COUCH_USER=...
//   VITE_COUCH_PASS=...
// If VITE_COUCH_URL is empty, the app stays purely local-first.

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

/**
 * Task shape:
 *   { _id, _rev, type: 'task',
 *     title, notes, tags[], source, due,
 *     done, inbox, created, updated }
 */
export async function createTask({ title, notes = '', tags = [], source = null, inbox = false, due = null }) {
  const doc = {
    _id: `task:${uuid()}`,
    type: 'task',
    title,
    notes,
    done: false,
    inbox,
    tags,
    source,
    due,
    created: now(),
    updated: now()
  };
  await db.put(doc);
  return doc;
}

export async function updateTask(task, patch) {
  const next = { ...task, ...patch, updated: now() };
  const res = await db.put(next);
  return { ...next, _rev: res.rev };
}

export async function deleteTask(task) {
  return db.remove(task);
}

/** Fetch tasks for a named view: 'today' | 'inbox' | 'all'. */
export async function getTasks(view) {
  const selector = { type: 'task', done: false };
  if (view === 'inbox') {
    selector.inbox = true;
  } else if (view === 'today') {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    selector.due = { $lte: end.toISOString() };
  }
  const res = await db.find({ selector, limit: 500 });
  return res.docs;
}

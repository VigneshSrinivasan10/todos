import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  db,
  initDb,
  startSync,
  stopSync,
  createTask,
  updateTask,
  deleteTask,
  restoreTask,
  purgeTask,
  getAllTasks
} from './db.js';

const VIEWS = [
  { key: 'today', label: 'Today' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'all', label: 'All' },
  { key: 'done', label: 'Done' },
  { key: 'trash', label: 'Trash' }
];

export default function App() {
  const [view, setView] = useState('today');
  const [allTasks, setAllTasks] = useState([]);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [syncState, setSyncState] = useState('local');
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message, { action, duration = 5000 } = {}) => {
      const id = ++toastIdRef.current;
      setToasts((ts) => [...ts, { id, message, action }]);
      if (duration > 0) setTimeout(() => dismissToast(id), duration);
      return id;
    },
    [dismissToast]
  );

  const refresh = useCallback(async () => {
    setAllTasks(await getAllTasks());
  }, []);

  useEffect(() => {
    let changes;
    (async () => {
      await initDb();
      await refresh();
      changes = db
        .changes({ since: 'now', live: true, include_docs: true })
        .on('change', () => refresh());
      const handler = startSync({
        onChange: () => setSyncState('synced'),
        onError: () => setSyncState('offline')
      });
      if (handler) setSyncState('syncing');
    })();
    return () => {
      changes?.cancel();
      stopSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- view derivation ------------------------------------------------------

  const counts = useMemo(() => {
    const c = { today: 0, inbox: 0, all: 0, done: 0, trash: 0 };
    const endOfToday = (() => {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    })();
    for (const t of allTasks) {
      if (t.type !== 'task') continue;
      if (t.deleted) {
        c.trash++;
        continue;
      }
      if (t.done) {
        c.done++;
        continue;
      }
      c.all++;
      if (t.inbox) c.inbox++;
      if (t.due && t.due <= endOfToday) c.today++;
    }
    return c;
  }, [allTasks]);

  const tasks = useMemo(() => {
    const endOfToday = (() => {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    })();
    const q = query.trim().toLowerCase();
    const matches = (t) => {
      if (!q) return true;
      if (t.title?.toLowerCase().includes(q)) return true;
      if (t.notes?.toLowerCase().includes(q)) return true;
      if (t.tags?.some((tg) => tg.toLowerCase().includes(q))) return true;
      return false;
    };
    const filter = (t) => {
      if (t.type !== 'task') return false;
      if (view === 'trash') return t.deleted;
      if (t.deleted) return false;
      if (view === 'done') return t.done;
      if (t.done) return false;
      if (view === 'inbox') return t.inbox;
      if (view === 'today') return t.due && t.due <= endOfToday;
      return true;
    };
    const list = allTasks.filter((t) => filter(t) && matches(t));
    list.sort((a, b) => {
      if (view === 'trash') return (b.deletedAt || '').localeCompare(a.deletedAt || '');
      if (view === 'done') return (b.updated || '').localeCompare(a.updated || '');
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return (b.created || '').localeCompare(a.created || '');
    });
    return list;
  }, [allTasks, view, query]);

  // ---- actions --------------------------------------------------------------

  async function onAdd(e) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    await createTask({ title, inbox: true });
    setDraft('');
    showToast(`Added “${truncate(title)}” to inbox`);
  }

  async function onToggle(task) {
    const nextDone = !task.done;
    const updated = await updateTask(task, { done: nextDone });
    showToast(nextDone ? `Marked done` : `Reopened`, {
      action: { label: 'Undo', run: () => updateTask(updated, { done: !nextDone }) }
    });
  }

  async function onTriage(task) {
    const updated = await updateTask(task, { inbox: false });
    showToast(`Triaged “${truncate(task.title)}”`, {
      action: { label: 'Undo', run: () => updateTask(updated, { inbox: true }) }
    });
  }

  async function onDelete(task) {
    const updated = await deleteTask(task);
    showToast(`Deleted “${truncate(task.title)}”`, {
      action: { label: 'Undo', run: () => restoreTask(updated) }
    });
  }

  async function onRestore(task) {
    await restoreTask(task);
    showToast(`Restored “${truncate(task.title)}”`);
  }

  async function onPurge(task) {
    if (!confirm(`Delete "${task.title}" permanently? This cannot be undone.`)) return;
    await purgeTask(task);
    showToast(`Purged “${truncate(task.title)}”`);
  }

  async function onSaveEdit(task, newTitle) {
    const trimmed = newTitle.trim();
    setEditingId(null);
    if (!trimmed || trimmed === task.title) return;
    const prevTitle = task.title;
    const updated = await updateTask(task, { title: trimmed });
    showToast(`Edited`, {
      action: { label: 'Undo', run: () => updateTask(updated, { title: prevTitle }) }
    });
  }

  async function onPatch(task, patch, message) {
    const updated = await updateTask(task, patch);
    showToast(message || 'Updated', {
      action: {
        label: 'Undo',
        run: () => {
          const inverse = {};
          for (const k of Object.keys(patch)) inverse[k] = task[k] ?? null;
          return updateTask(updated, inverse);
        }
      }
    });
  }

  const isTrash = view === 'trash';
  const isDone = view === 'done';

  return (
    <div className="app">
      <header className="header">
        <h1>todos</h1>
        <span className={`sync sync-${syncState}`}>● {syncState}</span>
      </header>

      <nav className="tabs" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={`tab ${view === v.key ? 'tab-active' : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
            {counts[v.key] > 0 && <span className="tab-count">{counts[v.key]}</span>}
          </button>
        ))}
      </nav>

      {!isTrash && !isDone && (
        <form className="quickadd" onSubmit={onAdd}>
          <input
            placeholder="quick add — drops to inbox"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
      )}

      <div className="search">
        <input
          placeholder="search title, notes, tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="clear search">×</button>
        )}
      </div>

      <ul className="list">
        {tasks.length === 0 && (
          <li className="empty">
            {query ? 'no matches.' : isTrash ? 'trash is empty.' : isDone ? 'nothing done yet.' : 'nothing here.'}
          </li>
        )}
        {tasks.map((t) => (
          <TaskRow
            key={t._id}
            task={t}
            view={view}
            editing={editingId === t._id}
            expanded={expandedId === t._id}
            onStartEdit={() => setEditingId(t._id)}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={(title) => onSaveEdit(t, title)}
            onToggleExpand={() => setExpandedId((id) => (id === t._id ? null : t._id))}
            onToggle={() => onToggle(t)}
            onTriage={() => onTriage(t)}
            onDelete={() => onDelete(t)}
            onRestore={() => onRestore(t)}
            onPurge={() => onPurge(t)}
            onPatch={(patch, msg) => onPatch(t, patch, msg)}
          />
        ))}
      </ul>

      <ToastStack toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}

function TaskRow({
  task,
  view,
  editing,
  expanded,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleExpand,
  onToggle,
  onTriage,
  onDelete,
  onRestore,
  onPurge,
  onPatch
}) {
  const isTrash = view === 'trash';
  const isDone = view === 'done';

  return (
    <li className={`item ${expanded ? 'item-expanded' : ''}`}>
      {!isTrash && (
        <button className="check" onClick={onToggle} aria-label="toggle done">
          {task.done ? '▣' : '▢'}
        </button>
      )}
      <div className="body">
        {editing ? (
          <EditField initial={task.title} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : (
          <button
            className={`title title-button ${task.done ? 'title-done' : ''}`}
            onClick={isTrash ? undefined : onStartEdit}
            disabled={isTrash}
            title={isTrash ? '' : 'click to edit'}
          >
            {task.title}
          </button>
        )}
        <div className="meta">
          {task.source && <span className="tag">⤴ {task.source}</span>}
          {task.due && <span className={`tag ${isOverdue(task.due) && !task.done ? 'tag-warn' : ''}`}>⏱ {fmtDue(task.due)}</span>}
          {task.tags?.map((tg) => (
            <span key={tg} className="tag">#{tg}</span>
          ))}
          {task.inbox && view !== 'inbox' && !isTrash && !isDone && <span className="tag tag-inbox">inbox</span>}
          {isTrash && task.deletedAt && <span className="tag tag-muted">deleted {fmtDue(task.deletedAt)}</span>}
        </div>
        {expanded && !isTrash && (
          <Details task={task} onPatch={onPatch} />
        )}
      </div>
      <div className="actions">
        {!isTrash && !editing && (
          <>
            <button className="icon-btn" onClick={onToggleExpand} title={expanded ? 'collapse' : 'details'}>
              {expanded ? '▴' : '▾'}
            </button>
            <button className="icon-btn" onClick={onStartEdit} title="edit title">✎</button>
            {task.inbox && (
              <button className="icon-btn" onClick={onTriage} title="triage out of inbox">→</button>
            )}
            <button className="icon-btn" onClick={onDelete} title="delete">✕</button>
          </>
        )}
        {isTrash && (
          <>
            <button className="icon-btn" onClick={onRestore} title="restore">↺</button>
            <button className="icon-btn icon-btn-warn" onClick={onPurge} title="delete forever">⌫</button>
          </>
        )}
      </div>
    </li>
  );
}

function Details({ task, onPatch }) {
  const [notes, setNotes] = useState(task.notes || '');
  const [tagsText, setTagsText] = useState((task.tags || []).join(', '));
  const dueValue = task.due ? toLocalInputValue(task.due) : '';

  function commitNotes() {
    if (notes === (task.notes || '')) return;
    onPatch({ notes }, 'Notes saved');
  }

  function commitTags() {
    const parsed = tagsText.split(',').map((s) => s.trim()).filter(Boolean);
    const same = JSON.stringify(parsed) === JSON.stringify(task.tags || []);
    if (same) return;
    onPatch({ tags: parsed }, 'Tags saved');
  }

  function setDue(value) {
    if (!value) {
      if (!task.due) return;
      onPatch({ due: null }, 'Due cleared');
      return;
    }
    const iso = fromLocalInputValue(value);
    if (iso === task.due) return;
    onPatch({ due: iso }, 'Due updated');
  }

  function quickDue(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(23, 59, 0, 0);
    onPatch({ due: d.toISOString() }, offsetDays === 0 ? 'Due today' : offsetDays === 1 ? 'Due tomorrow' : 'Due updated');
  }

  return (
    <div className="details">
      <div className="detail-row">
        <label>due</label>
        <input
          type="datetime-local"
          value={dueValue}
          onChange={(e) => setDue(e.target.value)}
        />
        <div className="quick">
          <button type="button" className="chip" onClick={() => quickDue(0)}>today</button>
          <button type="button" className="chip" onClick={() => quickDue(1)}>tomorrow</button>
          <button type="button" className="chip" onClick={() => quickDue(7)}>+1w</button>
          {task.due && <button type="button" className="chip chip-clear" onClick={() => setDue('')}>clear</button>}
        </div>
      </div>
      <div className="detail-row">
        <label>tags</label>
        <input
          placeholder="comma-separated"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          onBlur={commitTags}
        />
      </div>
      <div className="detail-row">
        <label>notes</label>
        <textarea
          rows={3}
          placeholder="notes, links, context…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
        />
      </div>
    </div>
  );
}

function EditField({ initial, onSave, onCancel }) {
  const [val, setVal] = useState(initial);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  function onKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSave(val);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }
  return (
    <input
      ref={inputRef}
      className="edit-input"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => onSave(val)}
    />
  );
}

function ToastStack({ toasts, dismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast-close" aria-label="dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

function fmtDue(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isOverdue(iso) {
  return new Date(iso) < new Date();
}

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v) {
  return new Date(v).toISOString();
}

function truncate(s, n = 40) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

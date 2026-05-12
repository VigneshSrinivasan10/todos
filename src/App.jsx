import { useCallback, useEffect, useState } from 'react';
import {
  db,
  initDb,
  startSync,
  stopSync,
  createTask,
  updateTask,
  deleteTask,
  getTasks
} from './db.js';

const VIEWS = [
  { key: 'today', label: 'Today' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'all', label: 'All' }
];

export default function App() {
  const [view, setView] = useState('today');
  const [tasks, setTasks] = useState([]);
  const [draft, setDraft] = useState('');
  const [syncState, setSyncState] = useState('local');

  const refresh = useCallback(async () => {
    const docs = await getTasks(view);
    docs.sort((a, b) => {
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return b.created.localeCompare(a.created);
    });
    setTasks(docs);
  }, [view]);

  // Bootstrap: indexes, initial load, change feed, optional sync.
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
    // refresh changes when `view` does — handled by next effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
  }, [view, refresh]);

  async function onAdd(e) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    // Quick-add lands in inbox so you triage before committing to a list.
    await createTask({ title, inbox: true });
    setDraft('');
  }

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
          </button>
        ))}
      </nav>

      <form className="quickadd" onSubmit={onAdd}>
        <input
          autoFocus
          placeholder="quick add — drops to inbox"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>

      <ul className="list">
        {tasks.length === 0 && <li className="empty">nothing here.</li>}
        {tasks.map((t) => (
          <TaskRow
            key={t._id}
            task={t}
            view={view}
            onToggle={() => updateTask(t, { done: !t.done })}
            onTriage={() => updateTask(t, { inbox: false })}
            onDelete={() => deleteTask(t)}
          />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({ task, view, onToggle, onTriage, onDelete }) {
  return (
    <li className="item">
      <button className="check" onClick={onToggle} aria-label="toggle done">
        {task.done ? '▣' : '▢'}
      </button>
      <div className="body">
        <div className="title">{task.title}</div>
        <div className="meta">
          {task.source && <span className="tag">⤴ {task.source}</span>}
          {task.due && <span className="tag">⏱ {fmtDue(task.due)}</span>}
          {task.tags?.map((tg) => (
            <span key={tg} className="tag">#{tg}</span>
          ))}
          {task.inbox && view !== 'inbox' && <span className="tag tag-inbox">inbox</span>}
        </div>
      </div>
      <div className="actions">
        {task.inbox && (
          <button className="icon-btn" onClick={onTriage} title="triage out of inbox">
            →
          </button>
        )}
        <button className="icon-btn" onClick={onDelete} title="delete">
          ✕
        </button>
      </div>
    </li>
  );
}

function fmtDue(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

import { useState, useEffect } from 'react';

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'done';
}

interface Stats {
  total: number;
  pending: number;
  done: number;
  completionPercentage: number;
}

function EmptyState() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const delay = Math.random() * 200;
    const timer = setTimeout(() => setChecked(true), delay);
    return () => clearTimeout(timer);
  }, []);

  if (!checked) return null;
  return <p className="empty-state" data-testid="empty-state">No tasks yet</p>;
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, done: 0, completionPercentage: 0 });
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [formReady, setFormReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFormReady(true), Math.random() * 150);
    return () => clearTimeout(timer);
  }, []);

  async function fetchData() {
    const [tasksRes, statsRes] = await Promise.all([
      fetch('/tasks'),
      fetch('/tasks/stats'),
    ]);
    setTasks(await tasksRes.json());
    setStats(await statsRes.json());
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await fetch('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setTitle('');
    fetchData();
  }

  async function toggleStatus(task: Task) {
    await fetch(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: task.status === 'pending' ? 'done' : 'pending' }),
    });
    fetchData();
  }

  async function removeTask(id: number) {
    await fetch(`/tasks/${id}`, { method: 'DELETE' });
    fetchData();
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1>Task Manager</h1>

      <div className="stats-bar" data-testid="stats-bar">
        <div className="stat"><strong>{stats.total}</strong> total</div>
        <div className="stat"><strong>{stats.pending}</strong> pending</div>
        <div className="stat"><strong>{stats.done}</strong> done</div>
        <div className="stat"><strong>{stats.completionPercentage.toFixed(1)}%</strong> complete</div>
      </div>

      <form onSubmit={addTask} data-testid="add-task-form">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a new task..."
          data-testid="task-input"
        />
        <button type="submit" data-testid="add-task-btn" disabled={!formReady}>Add Task</button>
      </form>

      {tasks.length === 0 && !loading ? (
        <EmptyState />
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className={`task-item ${task.status}`}>
              <input
                type="checkbox"
                checked={task.status === 'done'}
                onChange={() => toggleStatus(task)}
                data-testid={`toggle-${task.id}`}
              />
              <span className="task-title" data-testid={`task-title-${task.id}`}>
                {task.title}
              </span>
              <button
                className="delete-btn"
                onClick={() => removeTask(task.id)}
                data-testid={`delete-${task.id}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

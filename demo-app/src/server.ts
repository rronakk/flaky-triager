import { createDb } from './db.js';
import { createApp } from './app.js';

const db = createDb('tasks.db');
const app = createApp(db);
const port = process.env.PORT ?? 3000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

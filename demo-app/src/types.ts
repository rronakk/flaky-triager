export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'done';
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: 'pending' | 'done';
}

export interface TaskStats {
  total: number;
  pending: number;
  done: number;
  completionPercentage: number;
}

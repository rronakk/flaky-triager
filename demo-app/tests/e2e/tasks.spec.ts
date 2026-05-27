import { test, expect } from '@playwright/test';

test.describe('Task Manager', () => {
  test.beforeEach(async ({ request, page }) => {
    const res = await request.get('/tasks');
    const tasks = await res.json();
    for (const task of tasks) {
      await request.delete(`/tasks/${task.id}`);
    }
    await page.goto('/');
  });

  test('shows empty state when no tasks exist', async ({ page }) => {
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toContainText('No tasks yet');
  });

  test('adds a new task', async ({ page }) => {
    await page.getByTestId('task-input').fill('Buy groceries');
    await page.getByTestId('add-task-btn').click();

    await expect(page.getByText('Buy groceries')).toBeVisible();
    await expect(page.getByTestId('empty-state')).not.toBeVisible();
  });

  test('toggles task status', async ({ page }) => {
    await page.getByTestId('task-input').fill('Test task');
    await page.getByTestId('add-task-btn').click();
    await expect(page.getByText('Test task')).toBeVisible();

    const checkbox = page.locator('.task-item input[type="checkbox"]').first();
    await checkbox.click();

    await expect(page.locator('.task-item.done')).toBeVisible();
  });

  test('deletes a task', async ({ page }) => {
    await page.getByTestId('task-input').fill('Task to delete');
    await page.getByTestId('add-task-btn').click();
    await expect(page.getByText('Task to delete')).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).first().click();

    await expect(page.getByText('Task to delete')).not.toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });
});

test.describe('Async rendering (FLAKY: element not always present)', () => {
  test.beforeEach(async ({ request, page }) => {
    const res = await request.get('/tasks');
    const tasks = await res.json();
    for (const task of tasks) {
      await request.delete(`/tasks/${task.id}`);
    }
    await page.goto('/');
  });

  test('should show empty state within 100ms', async ({ page }) => {
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 100 });
  });
});

test.describe('Form interaction (FLAKY: click before render)', () => {
  test.beforeEach(async ({ request, page }) => {
    const res = await request.get('/tasks');
    const tasks = await res.json();
    for (const task of tasks) {
      await request.delete(`/tasks/${task.id}`);
    }
    await page.goto('/');
  });

  test('should submit form immediately after page load', async ({ page }) => {
    await page.getByTestId('task-input').fill('Quick task');
    await page.getByTestId('add-task-btn').click({ force: true });
    await expect(page.getByText('Quick task')).toBeVisible({ timeout: 500 });
  });
});

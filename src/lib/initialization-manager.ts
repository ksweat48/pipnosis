type InitializationTask = {
  name: string;
  task: () => Promise<void>;
  timeout?: number;
  retries?: number;
  optional?: boolean;
};

type InitializationResult = {
  success: boolean;
  failedTasks: string[];
  completedTasks: string[];
  duration: number;
};

class InitializationManager {
  private tasks: InitializationTask[] = [];
  private results: Map<string, boolean> = new Map();
  private startTime: number = 0;

  addTask(task: InitializationTask): void {
    this.tasks.push({
      timeout: 30000,
      retries: 2,
      optional: false,
      ...task,
    });
  }

  async initialize(): Promise<InitializationResult> {
    this.startTime = Date.now();
    const completedTasks: string[] = [];
    const failedTasks: string[] = [];

    console.log('[InitManager] Starting initialization with', this.tasks.length, 'tasks');

    for (const task of this.tasks) {
      const success = await this.executeTask(task);
      this.results.set(task.name, success);

      if (success) {
        completedTasks.push(task.name);
        console.log(`[InitManager] ✓ ${task.name} completed`);
      } else {
        failedTasks.push(task.name);
        if (!task.optional) {
          console.error(`[InitManager] ✗ ${task.name} failed (required)`);
        } else {
          console.warn(`[InitManager] ⚠ ${task.name} failed (optional)`);
        }
      }

      if (!success && !task.optional) {
        break;
      }
    }

    const duration = Date.now() - this.startTime;
    const success = failedTasks.length === 0 ||
                   failedTasks.every(name =>
                     this.tasks.find(t => t.name === name)?.optional
                   );

    console.log(`[InitManager] Initialization ${success ? 'completed' : 'failed'} in ${duration}ms`);

    return {
      success,
      completedTasks,
      failedTasks,
      duration,
    };
  }

  private async executeTask(task: InitializationTask): Promise<boolean> {
    let lastError: Error | null = null;
    const maxRetries = task.retries || 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[InitManager] Retrying ${task.name} (attempt ${attempt + 1}/${maxRetries + 1})`);
          await this.delay(Math.min(1000 * attempt, 3000));
        }

        await this.executeWithTimeout(task.task, task.timeout || 30000);
        return true;
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          console.warn(`[InitManager] ${task.name} failed, will retry:`, error);
        }
      }
    }

    if (lastError) {
      console.error(`[InitManager] ${task.name} failed after ${maxRetries + 1} attempts:`, lastError);
    }

    return false;
  }

  private async executeWithTimeout(
    fn: () => Promise<void>,
    timeoutMs: number
  ): Promise<void> {
    return Promise.race([
      fn(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isTaskComplete(taskName: string): boolean {
    return this.results.get(taskName) === true;
  }

  getResult(taskName: string): boolean | undefined {
    return this.results.get(taskName);
  }

  reset(): void {
    this.tasks = [];
    this.results.clear();
    this.startTime = 0;
  }
}

export const initializationManager = new InitializationManager();

export function withInitializationRetry<T>(
  fn: () => Promise<T>,
  options: {
    taskName: string;
    timeout?: number;
    retries?: number;
    optional?: boolean;
  }
): Promise<T> {
  const { taskName, timeout = 30000, retries = 2 } = options;

  return new Promise(async (resolve, reject) => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, Math.min(1000 * attempt, 3000)));
        }

        const result = await Promise.race([
          fn(),
          new Promise<T>((_, rej) =>
            setTimeout(() => rej(new Error(`${taskName} timeout after ${timeout}ms`)), timeout)
          ),
        ]);

        return resolve(result);
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries) {
          console.warn(`[${taskName}] Attempt ${attempt + 1} failed, retrying...`, error);
        }
      }
    }

    reject(lastError || new Error(`${taskName} failed after ${retries + 1} attempts`));
  });
}

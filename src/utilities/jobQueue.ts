// In-process work queue. Managers enqueue slow work (interpretation) instead of blocking
// callers or calling each other.

type JobState = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  name: string;
  state: JobState;
  error?: string;
}

export class JobQueue {
  private readonly jobs = new Map<string, Job>();
  private tail: Promise<void> = Promise.resolve();

  enqueue(id: string, name: string, work: () => Promise<void>): Job {
    const job: Job = { id, name, state: "queued" };
    this.jobs.set(id, job);
    this.tail = this.tail.then(() => this.run(job, work));
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return [...this.jobs.values()];
  }

  /** Resolves once every job enqueued so far has settled. */
  idle(): Promise<void> {
    return this.tail;
  }

  private async run(job: Job, work: () => Promise<void>): Promise<void> {
    job.state = "running";
    try {
      await work();
      job.state = "done";
    } catch (error) {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }
  }
}

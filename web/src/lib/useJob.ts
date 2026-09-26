import { useEffect, useState } from "react";
import { type Job, api } from "../api";

/** Polls a job until it settles. */
export function useJob(id: string | undefined, intervalMs = 1500): Job | undefined {
  const [job, setJob] = useState<Job>();
  useEffect(() => {
    if (!id) return;
    let live = true;
    const poll = async () => {
      const next = await api.job(id).catch(() => undefined);
      if (!live) return;
      setJob(next);
      if (next?.state === "queued" || next?.state === "running") timer = setTimeout(poll, intervalMs);
    };
    let timer = setTimeout(poll, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, intervalMs]);
  return job;
}

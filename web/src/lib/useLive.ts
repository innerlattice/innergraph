import { useEffect, useRef } from "react";

/** Calls `onChange` with the new Log position whenever any process appends to the Vault. */
export function useLive(onChange: (position: string) => void, url = "/api/stream"): void {
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(url);
    let first = true;
    source.addEventListener("position", (e) => {
      if (!first) callback.current((e as MessageEvent<string>).data);
      first = false;
    });
    return () => source.close();
  }, [url]);
}

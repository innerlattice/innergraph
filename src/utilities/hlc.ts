// Hybrid Logical Clock. Encoded as a fixed-width string so lexical order is total order.

export interface Timestamp {
  wall: number;
  counter: number;
  device: string;
}

const WALL_WIDTH = 15;
const COUNTER_WIDTH = 6;

export function encodeHlc(ts: Timestamp): string {
  const wall = String(ts.wall).padStart(WALL_WIDTH, "0");
  const counter = String(ts.counter).padStart(COUNTER_WIDTH, "0");
  return `${wall}.${counter}.${ts.device}`;
}

export function decodeHlc(hlc: string): Timestamp {
  const [wall, counter, ...device] = hlc.split(".");
  return { wall: Number(wall), counter: Number(counter), device: device.join(".") };
}

/** Smallest HLC at or after a wall-clock instant; useful as a time-travel bound. */
export function hlcAtTime(ms: number): string {
  return encodeHlc({ wall: ms, counter: 999999, device: "￿" });
}

export function hlcToDate(hlc: string): Date {
  return new Date(decodeHlc(hlc).wall);
}

export class HlcClock {
  private last: Timestamp;

  constructor(
    private readonly device: string,
    private readonly now: () => number = Date.now,
    lastSeen?: string,
  ) {
    this.last = lastSeen ? decodeHlc(lastSeen) : { wall: 0, counter: 0, device };
  }

  tick(): string {
    const physical = this.now();
    const wall = Math.max(physical, this.last.wall);
    const counter = wall === this.last.wall ? this.last.counter + 1 : 0;
    this.last = { wall, counter, device: this.device };
    return encodeHlc(this.last);
  }

  receive(remote: string): void {
    const r = decodeHlc(remote);
    if (r.wall > this.last.wall || (r.wall === this.last.wall && r.counter > this.last.counter)) {
      this.last = { wall: r.wall, counter: r.counter, device: this.device };
    }
  }
}

/** Accepts an HLC string or anything Date.parse understands. */
export function toPosition(at: string): string {
  if (/^\d{15}\.\d{6}\./.test(at)) return at;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`Cannot read time position "${at}"`);
  return hlcAtTime(ms);
}

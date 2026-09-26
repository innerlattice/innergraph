import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function newId(): string {
  return ulid();
}

export function newKey(): string {
  return randomBytes(32).toString("hex");
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function byteOffset(text: string, charIndex: number): number {
  return Buffer.byteLength(text.slice(0, charIndex), "utf8");
}

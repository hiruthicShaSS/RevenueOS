import { randomBytes } from "node:crypto";

export function id(prefix: string) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function isoDate(d: Date | string) {
  return new Date(d).toISOString().slice(0, 10);
}

export function weekday(d: Date | string) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

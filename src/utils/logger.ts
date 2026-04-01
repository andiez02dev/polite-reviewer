import { logStructured } from "../config.js";

export function info(message: string, details: Record<string, unknown> = {}): void {
  logStructured(message, { level: "info", ...details });
}

export function warn(message: string, details: Record<string, unknown> = {}): void {
  logStructured(message, { level: "warn", ...details });
}

export function error(message: string, details: Record<string, unknown> = {}): void {
  logStructured(message, { level: "error", ...details });
}

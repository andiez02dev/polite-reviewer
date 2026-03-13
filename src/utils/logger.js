import { logStructured } from "../config.js";

export function info(message, details = {}) {
  logStructured(message, { level: "info", ...details });
}

export function warn(message, details = {}) {
  logStructured(message, { level: "warn", ...details });
}

export function error(message, details = {}) {
  logStructured(message, { level: "error", ...details });
}


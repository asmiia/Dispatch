import { EventEmitter } from "node:events";
export const changes = (globalThis.__agentTeamChanges ??= new EventEmitter());
changes.setMaxListeners(80);
export function publish(change) {
  queueMicrotask(() => changes.emit("change", change));
}

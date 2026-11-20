import { EventEmitter } from "events";

/** Fired whenever position state or logs change, so the server can push updates over websockets. */
export const bus = new EventEmitter();

export const EVT_STATE_CHANGED = "state_changed";

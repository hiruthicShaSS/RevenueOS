import { config } from "../config.js";
import { HindsightStore } from "./hindsightStore.js";
import { MockStore } from "./mockStore.js";
import type { MemoryStore } from "./types.js";

export const memory: MemoryStore = config.memoryMode === "mock" ? new MockStore() : new HindsightStore();
export type { MemoryStore, MemoryHit } from "./types.js";

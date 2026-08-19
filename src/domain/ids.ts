import type { Clock, IdFactory } from "./types";

export const systemClock: Clock = { now: () => new Date() };
export const randomIdFactory: IdFactory = () => crypto.randomUUID();

export const timestamp = (clock: Clock) => clock.now().toISOString();

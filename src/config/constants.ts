import { FlowSnapshot } from "../logic/flowSnapshot";

export const FLOW_FORMAT_VERSION = "27.07.2025";

export const EMPTY_FLOW_SNAPSHOT: FlowSnapshot = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};
import { Viewport } from "@xyflow/react";
import { AppNode } from "./flowStore/interfaces";
import { FloatingEdge } from "./flowStore/edgeSlice";
import { initialFlow } from "../config/initialFlow";

/**
 * Represents all the data required to render the canvas.
 */
export interface FlowSnapshot {
  nodes: AppNode[];
  edges: FloatingEdge[];
  viewport: Viewport;
}


/**
 * Checks if an object is a valid FlowSnapshot of the current version.
 * @param obj - The object to check.
 * @returns True if the object is a valid FlowSnapshot, false otherwise.
 */
export function isFlowSnapshot(obj: any): obj is FlowSnapshot {
  return (
    obj &&
    obj?.nodes instanceof Array &&
    obj?.edges instanceof Array &&
    obj?.viewport instanceof Object
  );
}

/**
 * Parses a JSON object and checks if it is a valid FlowSnapshot.
 * If valid, returns the FlowSnapshot. Otherwise, throws an error.
 * @param json - The JSON object to parse.
 * @returns The FlowSnapshot if valid.
 * @throws An error if the JSON object is not a valid FlowSnapshot.
 */
export function parseFlow(json: any): FlowSnapshot {
  if (isFlowSnapshot(json)) {
    return json;
  } else {
    throw new Error(
      "Wrong config file. Probably it is outdated and not supported already."
    );
  }
}

/**
 * Parses a template flow JSON with relaxed validation.
 * Viewport is optional and will use default values if not provided.
 * @param json - The JSON object to parse.
 * @returns A FlowSnapshot with default viewport if not provided.
 * @throws An error if nodes or edges are missing or invalid.
 */
export function parseTemplateFlow(json: any): FlowSnapshot {
  if (!json || typeof json !== "object") {
    throw new Error("Invalid template flow: expected an object");
  }

  if (!Array.isArray(json.nodes)) {
    throw new Error("Invalid template flow: nodes must be an array");
  }

  if (!Array.isArray(json.edges)) {
    throw new Error("Invalid template flow: edges must be an array");
  }

  return {
    nodes: json.nodes || [],
    edges: json.edges || [],
    viewport: json.viewport || initialFlow.viewport,
  };
}


import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../workspace/useWorkspace";

// Canvas edge with a hover midpoint delete control for input connections,
// restoring the old FloatingEdge affordance without its store coupling.
// Result edges are immutable records: hover thickening only, no button.
// The hide grace period keeps the control mounted while the pointer travels
// from the path stroke onto the button (they live in separate DOM subtrees).
const HIDE_DELAY_MS = 250;

export const ManagedEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) => {
  const { activeFlow, dispatch } = useWorkspace();
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  const show = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovered(true);
  };
  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(false), HIDE_DELAY_MS);
  };
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const removable = (data as { kind?: string } | undefined)?.kind === "input";
  const remove = (event: React.MouseEvent) => {
    event.stopPropagation();
    const edge = activeFlow.edges.find((item) => item.id === id);
    if (edge?.kind === "input") dispatch({ type: "input/remove", flowId: activeFlow.id, edgeId: id });
  };
  return <>
    <g onMouseEnter={show} onMouseLeave={scheduleHide}>
      <BaseEdge id={id} path={edgePath} />
    </g>
    <EdgeLabelRenderer>
      {hovered && removable && <div className="managed-edge-control nodrag nopan" style={{ left: labelX, top: labelY }} onMouseEnter={show} onMouseLeave={scheduleHide}>
        <button type="button" aria-label="Remove connection" onClick={remove}>×</button>
      </div>}
    </EdgeLabelRenderer>
  </>;
};

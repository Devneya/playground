import {
  getBezierPath,
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
} from "@xyflow/react";

import useFlowStore from "../../../logic/flowStore/flowStore";

import { getEdgeParams } from "./utils";

import "./FloatingEdge.css";
import { Button } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

export default function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  markerStart,
  style,
}: EdgeProps) {
  const sourceNode = useFlowStore((state) => state.nodes.find((node) => node.id === source));
  const targetNode = useFlowStore((state) => state.nodes.find((node) => node.id === target));
  const mousePointed = useFlowStore(
    (state) => state.edges.find((edge) => edge.id === id)?.data?.hovered || false
  );
  const deleteEdge = useFlowStore.use.deleteEdge();

  if (!sourceNode || !targetNode) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode
  );

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    targetX: tx,
    targetY: ty,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={style}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            fontSize: 12,
            // everything inside EdgeLabelRenderer has no pointer events by default
            // if you have an interactive element, set pointer-events: all
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          {mousePointed ? (
            <Button
              fullWidth
              className="edgebutton"
              onClick={() => deleteEdge(id)}
              color="secondary"
              variant="outlined"
              sx={{
                position: "relative",
                boxSizing: "border-box",
                borderRadius: "100%",
                maxWidth: "30px",
                maxHeight: "30px",
                minWidth: "30px",
                minHeight: "30px",
                padding: 0,
                backgroundColor: "secondary.contrastText",
                "&:hover": {
                  backgroundColor: "error.main",
                  borderColor: "error.main",
                  color: "error.contrastText",
                },
                "& .MuiButton-startIcon": { margin: "0 0 0 0.5px" },
              }}
              startIcon={<CloseIcon />}
            />
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

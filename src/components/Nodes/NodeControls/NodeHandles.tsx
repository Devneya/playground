import React, {memo} from "react";
import {Handle, Position} from "@xyflow/react";

type NodeHandlesProps = {
  isConnecting: boolean;
  nodeId: string;
  connectionNodeId?: string;
  isConnectable?: boolean;
};

// Renders connection handles for a node
export const NodeHandles: React.FC<NodeHandlesProps> = memo(
  ({
     isConnecting,
     nodeId,
     connectionNodeId,
     isConnectable = true,
   }) => {
    return (
      <>
        {!isConnecting && nodeId !== connectionNodeId && (
          <Handle
            className="customHandle"
            position={Position.Right}
            type="source"
            isConnectable={isConnectable}
          />
        )}
        <Handle
          className="customHandle"
          position={Position.Left}
          type="target"
          isConnectable={isConnectable}
        />
      </>
    );
  });


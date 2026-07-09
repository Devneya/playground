import {NodeResizeControl} from "@xyflow/react";
import {SvgIcon} from "@mui/material";
import ResizeIcon from "../../../assets/icon-resize-node-24x24.svg?react";
import theme from "../../../themes";
import {controlStyle} from "../../../themes/componentStyles";
import React, {memo} from "react";

type NodeResizerProps = {
  size: { width: number; height: number };
  keepAspectRatio?: boolean;
  style?: React.CSSProperties;
};

// Renders a resizable control for a node
export const NodeResizer: React.FC<NodeResizerProps> = memo(
  ({
     size,
     keepAspectRatio = false,
     style,
   }) => (
    <NodeResizeControl
      style={{...controlStyle, ...style}}
      minWidth={size.width}
      minHeight={size.height}
      position="bottom-right"
      keepAspectRatio={keepAspectRatio}
    >
      <SvgIcon
        component={ResizeIcon}
        sx={{
          scale: "0.4",
          margin: "auto",
          color: theme.palette.text.disabled,
        }}
      />
    </NodeResizeControl>
  ));

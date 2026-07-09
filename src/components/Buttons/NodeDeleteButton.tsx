import {Close} from "@mui/icons-material";
import NodeButton from "./NodeButton";
import {memo} from "react";

type NodeDeleteButtonProps = {
  func: React.MouseEventHandler<HTMLButtonElement> | undefined;
  toClose?: boolean;
};

const NodeDeleteButton = (props: NodeDeleteButtonProps) => {
  return (
    <NodeButton
      icon={Close}
      func={props.func}
      toolTipValue={props.toClose ? undefined : "Delete"}
      sx={{
        "&:hover": {
          backgroundColor: "error.main",
          color: "error.contrastText",
        },
        "&:active": {backgroundColor: "error.dark", opacity: 1},
      }}
      iconSize="small"
    />
  );
};

export default memo(NodeDeleteButton);
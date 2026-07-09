import {SvgIconTypeMap, SxProps, Theme, Tooltip} from "@mui/material";
import {OverridableComponent} from "@mui/material/OverridableComponent";
import {StyledNodeButton} from "../../themes/componentStyles";
import {memo} from "react";

type NodeCustomButtonProps = {
  func?: React.MouseEventHandler<HTMLButtonElement> | undefined;
  icon: OverridableComponent<SvgIconTypeMap> & {
    muiName: string;
  };
  toolTipValue?: string;
  color?: string;
  bgcolor?: string;
  sx?: SxProps<Theme>;
  iconSize?: "small" | "medium" | "large";
  disabled?: boolean;
};

const NodeButton = (props: NodeCustomButtonProps) => {
  return (
    <Tooltip title={props.toolTipValue} placement="top" arrow>
      <span>
        <StyledNodeButton
          className="nodrag"
          size="medium"
          onClick={props.func}
          color={props.color as any}
          bgcolor={props.bgcolor}
          sx={props.sx}
          disabled={props.disabled ?? false}
        >
          <props.icon fontSize={props.iconSize ?? "small"}/>
        </StyledNodeButton>
      </span>
    </Tooltip>
  );
};

export default memo(NodeButton);
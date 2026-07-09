import {
  Button,
  ButtonPropsColorOverrides,
  CircularProgress,
  SvgIconTypeMap,
  Tooltip,
} from "@mui/material";
import {OverridableComponent} from "@mui/material/OverridableComponent";
import {OverridableStringUnion} from "@mui/types";
import {styledIcon} from "../../themes/componentStyles";
import {memo} from "react";

type SystemIconButtonProps = {
  func: React.MouseEventHandler<HTMLButtonElement> | undefined;
  icon: OverridableComponent<SvgIconTypeMap> & {
    muiName: string;
  };
  toolTipValue?: string;
  color?:
    | OverridableStringUnion<
    | "inherit"
    | "primary"
    | "secondary"
    | "success"
    | "error"
    | "info"
    | "warning",
    ButtonPropsColorOverrides
  >
    | undefined;
  contentBelow?: any;
  onGrayBack?: boolean;
  disabled?: boolean;
  isLoading?: boolean;
  tooltipPlacement?: "right" | "left" | "top" | "bottom"
};

const SystemIconButton = (props: SystemIconButtonProps) => {

  const coloring = props.onGrayBack
    ? {onHover: "primary.light", onPress: "primary.main"}
    : !props.color
      ? {onHover: "background.default", onPress: "divider"}
      : {onHover: "transparent", onPress: "transparent"};

  const button = (
    <Button
      onClick={props.func}
      disabled={props.disabled || props.isLoading}
      color={props.color ?? "inherit"}
      sx={{
        color: props.color ?? "text.primary",
        width: "32px",
        height: "32px",
        borderRadius: "4px",
        padding: 0,
        minWidth: "0px",
        "&:hover": {backgroundColor: coloring.onHover},
        "&:active": {backgroundColor: coloring.onPress},
        "&.MuiButtonBase-root:hover": {
          backgroundColor: props.color ? "none" : "transparent",
        },
      }}
    >
      {props.isLoading ? (
        <CircularProgress size={16} sx={{color: props.color ?? "text.primary"}}/>
      ) : (
        <props.icon sx={styledIcon}/>
      )}
      {props.contentBelow}
    </Button>
  );

  if (!props.toolTipValue) {
    return button;
  }

  return (
    <Tooltip
      title={props.toolTipValue}
      placement={props.tooltipPlacement ?? "right"}
      arrow
      disableInteractive
    >
      {button}
    </Tooltip>
  );
}

export default memo(SystemIconButton);
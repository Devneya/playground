import {ReactNode} from "react";
import {StyledSystemTextButton} from "../../themes/componentStyles";
import {memo} from "react";
import {ButtonProps, SxProps, Theme} from "@mui/material";

type CustomButtonProps = {
  type: "error" | "cleanup" | "send" | "default";
  func: React.MouseEventHandler<HTMLButtonElement> | undefined;
  label: ReactNode;
  isUsed?: boolean;
  data?: string;
};

const hoverOutlined = {
  color: "text.primary",
  borderColor: "transparent",
  "&:hover": {
    backgroundColor: "divider", borderColor: "transparent",
  },
};

type ButtonConfig = {
  variant: ButtonProps["variant"];
  color?: ButtonProps["color"];
  sx?: SxProps<Theme>;
  disabled?: boolean;
};

const SystemTextButton = (props: CustomButtonProps) => {

  const buttonMap: Record<CustomButtonProps["type"], ButtonConfig> = {
    error: {variant: "contained", color: "error", sx: {}, disabled: false},
    cleanup: {variant: "outlined", sx: hoverOutlined, disabled: false},
    send: {
      variant: props.isUsed ? "outlined" : "contained",
      disabled: !props.isUsed && props.data === "",
      sx: {
        ...(props.isUsed
          ? hoverOutlined
          : {"&:disabled": {backgroundColor: "transparent"}}),
        padding: "8px 12px 8px 16px",
        minWidth: "56px",
        maxWidth: "56px",
      },
    },
    default: {variant: "contained", sx: {}, disabled: false},
  };

  const {variant, color, sx, disabled} = buttonMap[props.type ?? "default"];
  return (
    <StyledSystemTextButton variant={variant as any} color={color} sx={sx} disabled={disabled} onClick={props.func}>
      {props.label}
    </StyledSystemTextButton>
  );
};

export default memo(SystemTextButton);
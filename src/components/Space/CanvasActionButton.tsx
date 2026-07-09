import React, {memo} from "react";
import {CircularProgress, IconButton, Tooltip, useTheme} from "@mui/material";
import {SvgIconTypeMap} from "@mui/material";
import {OverridableComponent} from "@mui/material/OverridableComponent";

/**
 * Action button component for canvas operations (rename, duplicate, export, delete).
 * Supports loading state and tooltips.
 */
type CanvasActionButtonProps = {
  icon: OverridableComponent<SvgIconTypeMap> & {
    muiName: string;
  };
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  tooltipValue?: string;
  tooltipPlacement?: "top" | "bottom" | "left" | "right";
  color?: "inherit" | "primary" | "secondary" | "error" | "info" | "success" | "warning";
  stopPropagation?: boolean;
  isLoading?: boolean;
  disabled?: boolean;
};

const CanvasActionButton: React.FC<CanvasActionButtonProps> = ({
                                                                 icon: Icon,
                                                                 onClick,
                                                                 tooltipValue,
                                                                 tooltipPlacement = "top",
                                                                 color,
                                                                 stopPropagation = true,
                                                                 isLoading = false,
                                                                 disabled = false,
                                                               }) => {
  const theme = useTheme();

  // Get the actual color value from theme palette to match icon color
  const getProgressColor = () => {
    if (!color) {
      return theme.palette.text.primary;
    }
    const colorMap: Record<string, string> = {
      primary: theme.palette.primary.main,
      secondary: theme.palette.secondary.main,
      error: theme.palette.error.main,
      info: theme.palette.info.main,
      success: theme.palette.success.main,
      warning: theme.palette.warning.main,
    };
    return colorMap[color] || theme.palette.text.primary;
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    onClick(e);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const button = (
    <IconButton
      size="small"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onMouseDown={handleMouseDown}
      disableRipple
      disableFocusRipple
      disabled={disabled || isLoading}
      color={color || undefined}
      sx={{
        width: 32,
        height: 32,
        borderRadius: 1,
        cursor: disabled || isLoading ? "not-allowed" : "pointer",
        backgroundColor: "transparent",
        color: color ?? "text.primary",
        "&:hover": {
          backgroundColor: disabled || isLoading ? "transparent" : "background.default",
        },
      }}
    >
      {isLoading ? (
        <CircularProgress size={16} sx={{color: getProgressColor()}}/>
      ) : (
        <Icon fontSize="small"/>
      )}
    </IconButton>
  );

  if (!tooltipValue) {
    return button;
  }

  return (
    <Tooltip title={tooltipValue} placement={tooltipPlacement} arrow disableInteractive>
      {button}
    </Tooltip>
  );
};

export default memo(CanvasActionButton);

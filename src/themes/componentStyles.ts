import {styled} from "@mui/system";
import {Box, Chip, Popover, Stack} from "@mui/material";
import {IconButton} from "@mui/material";
import {Button, MenuItem} from "@mui/material";
import theme from "./index";

export const VisuallyHiddenInput = styled("input")({
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  bottom: 0,
  left: 0,
  whiteSpace: "nowrap",
  width: 1,
});

export const BaseChip = styled(Chip)(() => ({
  ...theme.typography.overline,
  backgroundColor: theme.palette.background.paper,
  textTransform: "capitalize",
  letterSpacing: 0,
}));

export const ActiveChip = styled(BaseChip)(() => ({
  border: `1px solid ${theme.palette.secondary.dark}`,
  color: theme.palette.secondary.dark,
  "&:hover": {
    backgroundColor: theme.palette.secondary.dark,
    color: theme.palette.secondary.contrastText,
    border: "1px solid transparent",
  },
}));

export const InactiveChip = styled(BaseChip)(() => ({
  color: theme.palette.text.secondary,
  "&:hover": {
    backgroundColor: theme.palette.secondary.dark,
    color: theme.palette.secondary.contrastText,
  },
}));

export const ExecutedChip = styled(BaseChip)(() => ({
  border: `1px solid ${theme.palette.text.primary}`,
  color: theme.palette.text.primary,
}));

export const StyledNodeButton = styled(IconButton)<{
  color?: string;
  bgcolor?: string;
}>(({theme, color, bgcolor}) => ({
  padding: "6px",
  color: color ?? theme.palette.text.primary,
  backgroundColor: "transparent",
  "&:hover": {
    color: theme.palette.secondary.main,
    backgroundColor: theme.palette.secondary.light,
  },
  "&.Mui-disabled": {
    color: bgcolor ?? theme.palette.text.disabled,
  },
}));

export const StyledButton = styled(Button)(() => ({
  ...theme.typography.overline,
  letterSpacing: 0,
  borderRadius: "20px",
  padding: "4px 12px",
  minHeight: "32px",
  "&:hover": {
    backgroundColor: theme.palette.secondary.dark,
    color: theme.palette.secondary.contrastText,
  },
  "& .MuiButton-endIcon": {marginLeft: "4px"}
}));

export const StyledMenuItem = styled(MenuItem)(() => ({
  ...theme.typography.overline,
  letterSpacing: 0,
  padding: "8px",
  display: "flex",
  "&:hover": {backgroundColor: theme.palette.secondary.light,},
  '&.Mui-selected': {backgroundColor: theme.palette.secondary.light,},
  '&.Mui-selected:hover': {backgroundColor: theme.palette.secondary.light,},
}));

export const StyledPopover = styled(Popover)<{ zoom?: number }>(({theme, zoom}) => {
  const clampedZoom = zoom !== undefined ? Math.min(Math.max(zoom, 0.2), 2) : 1;
  const biggerZoom = zoom !== undefined ? clampedZoom * 1.1 : 1;

  return {
    "& .MuiPopover-paper": {
      borderRadius: "12px",
      transform: `translateX(${50 * clampedZoom}px) scale(${biggerZoom}) !important`,
      boxShadow: "0px 4px 5px 0px #0000000D"
    }
  };
});

export const styledIcon = {
  padding: "4px",
  borderRadius: "4px",
  width: "100%",
  height: "100%",
};

export const styledSystemIcon = {
  color: "text.secondary",
  width: 16,
  height: 16,
  transform: "translateX(-6px)",
};

export const StyledSystemTextButton = styled(Button)(() => ({
  boxShadow: "none",
  borderRadius: "16px",
  padding: "12px 20px",
  textTransform: "none",
}));

export const StyledAppBarStack = styled(Stack)<{ direction?: "column" | "row" }>(({theme, direction = "column"}) => ({
  gap: "5px",
  flexDirection: direction,
  alignItems: "center",
  borderRadius: "5px",
  pointerEvents: "all",
  padding: "8px 3px",
  boxShadow: "0 0 2px 1px rgba(0, 0, 0, 0.08)",
  backgroundColor: theme.palette.background.paper,
  "&:hover": {
    boxShadow: "0 1px 4px 1px rgba(0, 0, 0, 0.08)",
  },
}));

export const StyledNodeContainer = styled(Box)(() => ({
  padding: "8px",
  width: "100%",
  height: "100%",
  overflow: "visible",
  position: "relative",
  boxSizing: "border-box",
  alignItems: "center",
  justifyContent: "center",
}));

export const StyledNodeCard = styled(Box)(({theme}) => ({
  backgroundColor: theme.palette.background.paper,
  borderRadius: "24px",
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "visible",
}));

export const controlStyle = {
  background: "transparent",
  border: "none",
  zIndex: 10,
  width: "20px",
  height: "20px",
  margin: "-12px",
};
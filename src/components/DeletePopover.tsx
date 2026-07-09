import {Stack, Typography} from "@mui/material";
import React from "react";
import SystemTextButton from "./Buttons/SystemTextButton";
import {StyledPopover} from "../themes/componentStyles";

type DeletePopoverProps = {
  actionCallback: () => void;
  open: boolean;
  anchorEl: HTMLButtonElement | null;
  setAnchorEl: React.Dispatch<React.SetStateAction<HTMLButtonElement | null>>;
  centered: boolean;
  label: string;
  zoom?: number;
};

/**
 * DeletePopover component
 * A reusable confirmation popover with "Delete" and "Cancel" actions.
 */
export default function DeletePopover({
                                        actionCallback,
                                        open,
                                        anchorEl,
                                        setAnchorEl,
                                        centered,
                                        label,
                                        zoom
                                      }: DeletePopoverProps) {

  return (
    <>
      <StyledPopover
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorEl={centered ? null : anchorEl}
        anchorOrigin={
          centered
            ? {vertical: "center", horizontal: "center"}
            : {vertical: "bottom", horizontal: "center"}
        }
        transformOrigin={
          centered
            ? {vertical: "center", horizontal: "center"}
            : {vertical: "top", horizontal: "center"}
        }
        sx={{"& .MuiPopover-paper": {borderRadius: "16px"}}}
        zoom={zoom}
      >
        <Stack padding="16px" gap="8px" alignContent={"center"}>
          <Typography
            variant="subtitle1"
            textAlign={"center"}
            width="100%"
            gap={"10px"}
            sx={{marginTop: "12px", marginBottom: "-12px"}}
          >
            {label}
          </Typography>
          <Stack direction="row" padding="24px 0px 0px" gap="8px">
            <SystemTextButton
              type="error"
              func={() => {
                actionCallback();
                setAnchorEl(null);
              }}
              label={"Delete"}
            />
            <SystemTextButton
              type="cleanup"
              func={() => setAnchorEl(null)}
              label={"Cancel"}
            />
          </Stack>
        </Stack>
      </StyledPopover>
    </>
  );
}

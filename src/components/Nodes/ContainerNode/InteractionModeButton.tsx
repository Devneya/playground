import {Stack, Typography} from "@mui/material";
import {ArrowDropDown, ArrowDropUp, Done} from "@mui/icons-material";
import {memo, useState} from "react";
import * as React from "react";
import useViewport from "../../../logic/useViewport";
import useFlowStore from "../../../logic/flowStore/flowStore";
import {styledSystemIcon, StyledButton, StyledMenuItem, StyledPopover} from "../../../themes/componentStyles";
import {isPromptNodeData} from "../../../logic/flowStore/interfaces";

const interactionModes = ["Sequential", "Parallel"];

/**
 * InteractionModeButton component
 * Allows selecting the container's interaction mode (Sequential/Parallel) with a popover menu.
 */
const InteractionModeButton = ({nodeId}: { nodeId: string }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const [selectedMode, setSelectedMode] = useState<string>("Parallel");
  const {getViewport} = useViewport();
  const {zoom} = getViewport();
  const setInteractionModeFromContainer = useFlowStore.use.setInteractionModeFromContainer();
  const getNodeData = useFlowStore.use.getNodeData();

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    const aggregatePromptData = getNodeData(nodeId);
    if(!aggregatePromptData || !isPromptNodeData(aggregatePromptData) || aggregatePromptData.isExecuted) {
      return;
    }
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (mode: string) => {
    setSelectedMode(mode);
    setInteractionModeFromContainer(nodeId, mode);
    handleClose();
  };

  return (
    <>
      <StyledButton
        variant="outlined"
        color={"inherit"}
        onClick={handleClick}
        endIcon={open ? <ArrowDropUp/> : <ArrowDropDown/>}
        sx={{textTransform: "capitalize"}}
      >
        {selectedMode}
      </StyledButton>
      <StyledPopover
        zoom={zoom}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{vertical: "top", horizontal: "right"}}
        transformOrigin={{vertical: 17, horizontal: "left"}}
        sx={{"& .MuiPopover-paper": {width: "160px"}}}
      >
        <Stack>
          {interactionModes.map((mode) => (
            <StyledMenuItem
              key={mode}
              onClick={() => handleSelect(mode)}
              selected={selectedMode === mode}
            >
              <Typography
                variant="overline"
                sx={{
                  flexGrow: 1,
                  paddingLeft: "4px",
                  letterSpacing: 0,
                }}
              >
                {mode}
              </Typography>
              <Done sx={{...styledSystemIcon, color: mode === selectedMode ? "secondary.main" : "transparent"}}/>
            </StyledMenuItem>
          ))}
        </Stack>
      </StyledPopover>
    </>
  );
};

export default memo(InteractionModeButton);
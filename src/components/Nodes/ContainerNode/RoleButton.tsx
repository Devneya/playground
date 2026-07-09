import {memo, useState} from "react";
import useFlowStore from "../../../logic/flowStore/flowStore";
import {Stack, Tooltip, Typography} from "@mui/material";
import {ArrowDropDown, ArrowDropUp, Done} from "@mui/icons-material";
import useViewport from "../../../logic/useViewport";
import {roleDescriptions} from "../PromptNode/Request/systemPrompts";
import {StyledPopover, styledSystemIcon, StyledButton, StyledMenuItem} from "../../../themes/componentStyles";

const roles = ["assistant", "generator", "reflector", "ranker", "refiner", "grouper", "meta-evaluator"];

/**
 * RoleButton component
 * Displays a button to select a role for a proposer node, with a popover list of roles.
 */
const RoleButton = ({nodeId, selectedRole}: { nodeId: string, selectedRole?: string }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const [role, setRole] = useState(selectedRole || "assistant");
  const setRoleForProposer = useFlowStore.use.setRoleForProposer();
  const {getViewport} = useViewport();
  const {zoom} = getViewport();

  const handleSelect = (newRole: string) => {
    setRole(newRole);
    setRoleForProposer(nodeId, newRole);
    setAnchorEl(null);
  };

  return (
    <>
      <StyledButton
        sx={{height: "32px"}}
        variant="outlined"
        color="inherit"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        endIcon={open ? <ArrowDropUp/> : <ArrowDropDown/>}
      >
        Role: {role}
      </StyledButton>
      <StyledPopover
        zoom={zoom}
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{vertical: "bottom", horizontal: "left"}}
        transformOrigin={{vertical: "top", horizontal: "left"}}
        sx={{
          "& .MuiPopover-paper": {
            width: "160px",
            marginTop: "8px",
          },
        }}
      >
        <Stack>
          {roles.map((r) => (
            <Tooltip
              key={r}
              title={roleDescriptions[r]}
              placement="right"
              arrow
              enterDelay={300}
            >
              <StyledMenuItem selected={r === role} onClick={() => handleSelect(r)}>
                <Typography
                  variant="overline"
                  sx={{
                    flexGrow: 1,
                    paddingLeft: "4px",
                    letterSpacing: 0,
                  }}
                >
                  {r}
                </Typography>
                {r === role && <Done
                  sx={{
                    ...styledSystemIcon,
                    color:
                      role === selectedRole
                        ? "secondary.main"
                        : "transparent"
                  }}/>}
              </StyledMenuItem>
            </Tooltip>
          ))}
        </Stack>
      </StyledPopover>
    </>
  );
};

export default memo(RoleButton);
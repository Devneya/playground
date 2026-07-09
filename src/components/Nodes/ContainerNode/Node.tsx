import { ExpandLess, ExpandMore } from "@mui/icons-material";
import { Box, Stack } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { NodeProps } from "@xyflow/react";
import { isPromptNodeData, type ContainerNode as ContainerNodeType } from "../../../logic/flowStore/interfaces";
import useFlowStore from "../../../logic/flowStore/flowStore";
import DeletePopover from "../../DeletePopover";
import NodeDeleteButton from "../../Buttons/NodeDeleteButton";
import theme from "../../../themes";
import InteractionModeButton from "./InteractionModeButton";
import AddIcon from "@mui/icons-material/Add";
import usePromptNode from "../PromptNode/usePromptNode";
import { StyledButton, StyledNodeCard, StyledNodeContainer } from "../../../themes/componentStyles";
import { NodeHandles } from "../NodeControls/NodeHandles";
import NodeButton from "../../Buttons/NodeButton";
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

/**
 * ContainerNode component
 * Displays a container block that can hold compact prompt nodes
 */
export default function ContainerNode(props: NodeProps<ContainerNodeType>) {
  // node states
  const prevX = useRef(props.positionAbsoluteX);
  const prevY = useRef(props.positionAbsoluteY);

  //store methods
  const connectionNodeId = useFlowStore.use.connectionNodeId();
  const deleteNode = useFlowStore.use.deleteNodeWithEdges();
  const deleteNodesFromContainer = useFlowStore.use.deleteNodesFromContainer();
  const markAsAggregateNode = useFlowStore.use.markPromptNodeAsAggregateNode();
  const updatePositionForNodeInContainer = useFlowStore.use.updateNodePosition();
  const setIsUserDraggingContainer = useFlowStore.use.setIsUserDraggingContainer();
  const updateContainerContentNodesVisibility = useFlowStore.use.updateContainerContentNodesVisibility();
  const updateContainerPromptNodesVisibility = useFlowStore.use.updateContainerPromptNodesVisibility();
  const changeAreThoughtsShown = useFlowStore.use.changeAreThoughtsShown();
  const getContainerProposersNodes = useFlowStore.use.getContainerProposersNodes();
  const getContainerContentNodes = useFlowStore.use.getContainerContentNodes();
  const getContainerIsOpen = useFlowStore.use.getContainerIsOpen();
  const changeContainerIsOpen = useFlowStore.use.changeContainerIsOpen();
  const getNodeData = useFlowStore.use.getNodeData();

  const { copyAndAggregate } = usePromptNode();

  // other constants
  const isConnecting = !!connectionNodeId;
  const isPromptContainer = props.data.isPromptContainer ?? false;
  const isOpen = getContainerIsOpen(props.id);

  // Delete popover state
  const [deleteAnchorEl, setDeleteAnchorEl] = useState<HTMLButtonElement | null>(null);
  const handleDeleteButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setDeleteAnchorEl(deleteAnchorEl ? null : event.currentTarget);
  };
  const deleteNodePopoverOpened = Boolean(deleteAnchorEl);

  // Update child nodes positions when container is moved
  useEffect(() => {
    const deltaX = props.positionAbsoluteX - prevX.current;
    const deltaY = props.positionAbsoluteY - prevY.current;
    setIsUserDraggingContainer(props.id, true);

    if (deltaX !== 0 || deltaY !== 0) {
      const allNodes = [
        ...(getContainerProposersNodes(props.id) || []),
        ...(getContainerContentNodes(props.id) || []),
      ];
      allNodes.forEach((node) => {
        updatePositionForNodeInContainer(node.id, {
          x: node.position.x + deltaX,
          y: node.position.y + deltaY,
        });
      });
    }
    prevX.current = props.positionAbsoluteX;
    prevY.current = props.positionAbsoluteY;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.positionAbsoluteX, props.positionAbsoluteY, props.data.proposers]);

  const toggleContentVisibility = () => {
    updateContainerContentNodesVisibility(props.id, !props.data.areThoughtsShown);
    changeAreThoughtsShown(props.id, !props.data.areThoughtsShown);
  };

  const togglePromptsVisibility = () => {
    updateContainerPromptNodesVisibility(props.id, !isOpen);
    changeContainerIsOpen(props.id, !isOpen);
  };

  return (
    <StyledNodeContainer zIndex={1}>
      <NodeHandles isConnecting={isConnecting} nodeId={props.id} connectionNodeId={connectionNodeId}
        isConnectable={false} />
      <StyledNodeCard
        sx={{
          border: "1px solid",
          borderColor: theme.palette.text.disabled,
          ...(isPromptContainer ? {} : { backgroundColor: "transparent" }),
          "&:hover": {
            boxShadow: " 0px 4px 5px 0px rgba(0, 0, 0, 0.05)",
          },
        }}
      >
        <Stack
          direction={"row"}
          padding={"8px"}
          justifyContent={isPromptContainer ? "flex-end" : "space-between"}
          alignItems="center"
        >
          {!isPromptContainer &&
            (<NodeButton
              icon={AddIcon}
              func={() => {
                const aggregatePromptData = getNodeData(props.data.parentPromptId);
                if (!aggregatePromptData || !isPromptNodeData(aggregatePromptData) || aggregatePromptData.isExecuted) {
                  return;
                }
                copyAndAggregate(props.id);
              }}
              toolTipValue="Add proposer in MoA model"
              sx={{
                border: "1px solid black",
                "&:hover": {
                  backgroundColor: theme.palette.secondary.dark,
                  color: theme.palette.secondary.contrastText,
                  border: "1px solid transparent",
                }
              }}
            />)
          }
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {isPromptContainer ?
              (<Box sx={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <NodeButton
                  icon={isOpen ? ExpandLessIcon : ExpandMoreIcon}
                  func={togglePromptsVisibility}
                  color={"inherit"}
                  sx={{ textTransform: "capitalize" }}
                  toolTipValue={isOpen ? "Hide prompts" : "Show prompts"}
                />
                <NodeDeleteButton func={handleDeleteButtonClick} />
              </Box>)
              :
              (<Box sx={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <StyledButton
                  endIcon={props.data.areThoughtsShown ? <ExpandLess /> : <ExpandMore />}
                  onClick={toggleContentVisibility}
                  variant="outlined"
                  color={"inherit"}
                  sx={{ textTransform: "capitalize" }}
                >
                  {props.data.areThoughtsShown ? "Hide thinking" : "Show thinking"}
                </StyledButton>
                <InteractionModeButton nodeId={props.data.parentPromptId} />
                <NodeDeleteButton func={handleDeleteButtonClick} />
              </Box>)
            }
          </Box>
        </Stack>
      </StyledNodeCard>
      <DeletePopover
        actionCallback={() => {
          deleteNodesFromContainer(props.id);
          markAsAggregateNode(props.data.parentPromptId, false);
          deleteNode(props.id);
        }}
        open={deleteNodePopoverOpened}
        anchorEl={deleteAnchorEl}
        setAnchorEl={setDeleteAnchorEl}
        centered={false}
        label={"Delete block?"}
      />
    </StyledNodeContainer>
  );
}

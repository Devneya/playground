import {Box, Modal, Stack, Typography} from "@mui/material";
import useFlowStore from "../logic/flowStore/flowStore";
import React, {memo, useState, useEffect} from "react";
import {isPromptNodeData} from "../logic/flowStore/interfaces";
import theme from "../themes";
import {emptyModificationParams} from "../logic/models/defaultParams";
import JSON5 from "json5";
import NodeDeleteButton from "./Buttons/NodeDeleteButton";
import {StyledSystemTextButton} from "../themes/componentStyles";

type ModelParamsMenuProps = {
  isOpenModelParamsMenu: boolean;
};

const initialTemplate = `{
// Example settings:
// "temperature": 0.7,
// "top_p": 0.9,
// "max_tokens": 1024
}`;

function ModelParamsMenu(props: ModelParamsMenuProps) {
  const nodeId = useFlowStore.use.modelParamsNodeId();
  const getNodeData = useFlowStore.use.getNodeData();
  const selectedNodeData = getNodeData(nodeId);
  const selectedModel = useFlowStore.use.selectedModel();
  const closeModelParamsModal = useFlowStore.use.closeModelParamsMenu();
  const changeNodeModelConfiguration = useFlowStore.use.changeNodeModelConfiguration();

  const [hasParsingError, setHasParsingError] = useState<boolean>(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectedModels = (isPromptNodeData(selectedNodeData) && Array.isArray(selectedNodeData.selectedModels))
    ? selectedNodeData.selectedModels
    : [];
  const [modelParamsState, setModelParamsState] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!Array.isArray(selectedModels) || selectedModels.length === 0) return;
    const entries = selectedModels
      .filter((m) => m && m.name)
      .map((m) => [m.name, m.params?.trim() || ""]);
    setModelParamsState(Object.fromEntries(entries));
  }, [selectedModels]);

  const validateAndParse = (value: string) => {
    try {
      const parsed = JSON5.parse(value);
      setHasParsingError(false);
      return parsed;
    } catch {
      setHasParsingError(true);
      return null;
    }
  };

  const handleChange = (value: string) => {
    if (!selectedModel) return;
    validateAndParse(value);
    setModelParamsState((prev) => ({...prev, [selectedModel.name]: value}));
  };

  const handleSet = () => {
    if (!selectedModel) return;
    const rawValue = modelParamsState[selectedModel.name];
    const parsed = validateAndParse(rawValue);
    if (!parsed) return;

    const pretty = JSON.stringify(parsed, null, 2);

    changeNodeModelConfiguration(nodeId, {
      ...selectedModel,
      params: pretty,
    });

    setModelParamsState((prev) => ({...prev, [selectedModel.name]: pretty,}));
  };

  const isExecuted = isPromptNodeData(selectedNodeData)
    ? selectedNodeData.isExecuted
    : false;

  const value = (() => {
    if (!selectedModel) return "";
    const current = modelParamsState[selectedModel.name]?.trim();

    if (isExecuted) return current ?? "";
    if (!current || current === emptyModificationParams) return initialTemplate;

    return current;
  })();

  if (!selectedModel) {
    return (
      <Typography color="error" variant={"h1"}>
        Error selecting model
      </Typography>
    );
  }

  return (
    <Modal
      open={props.isOpenModelParamsMenu}
      sx={{display: "flex", alignItems: "center", justifyContent: "center"}}
    >
      <Box
        width="50vw"
        maxWidth="90vw"
        maxHeight="90vh"
        bgcolor="background.paper"
        borderRadius={"16px"}
        overflow="hidden"
        display="flex"
        flexDirection="column"
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          padding="12px 16px"
          borderBottom="1px solid"
          borderColor="divider"
        >
          <Typography variant="subtitle1">Model settings</Typography>
          <NodeDeleteButton func={closeModelParamsModal} toClose={true}/>
        </Stack>

        <Stack
          padding={"16px"}
          gap={"16px"}
          overflow="auto"
          flex={1}
          minHeight={0}
        >
          {isExecuted ? (
            selectedModels.map((model) => (
              <Stack key={model.name} gap={"8px"}>
                <Typography variant="subtitle2">
                  {model.name} - {model.type}
                </Typography>
                <textarea
                  value={modelParamsState[model.name]?.trim() || ""}
                  className="styled-scrollbars"
                  readOnly
                  rows={10}
                  style={{
                    width: "100%",
                    padding: "4px 8px",
                    backgroundColor: theme.palette.background.default,
                    border: "1px solid",
                    borderColor: "transparent",
                    borderRadius: "8px",
                    resize: "none",
                  }}
                />
              </Stack>
            ))
          ) : (
            <Stack gap={"12px"}>
            <textarea
              value={value}
              className="styled-scrollbars"
              onChange={(e) => handleChange(e.currentTarget.value)}
              disabled={isExecuted}
              rows={10}
              style={{
                padding: "4px 8px",
                backgroundColor: theme.palette.background.default,
                border: "1px solid",
                borderColor: hasParsingError ? theme.palette.error.main : "transparent",
                borderRadius: "8px",
                resize: "none",
                width: "100%",
              }}
            />
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  {hasParsingError && (
                    <Typography color="error" variant="body2">
                      Parsing Error
                    </Typography>
                  )}
                </Box>
                <StyledSystemTextButton
                  variant="outlined"
                  sx={{padding: "8px 16px"}}
                  disabled={isExecuted}
                  onClick={() => {
                    handleSet();
                  }}
                >
                  Set
                </StyledSystemTextButton>
              </Stack>
            </Stack>
          )}
        </Stack>
      </Box>
    </Modal>
  );
}

export default memo(ModelParamsMenu);
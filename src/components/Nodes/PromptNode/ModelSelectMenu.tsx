import * as React from "react";
import {
  Button,
  Divider,
  Box,
  Typography,
  Stack,
  InputBase, IconButton
} from "@mui/material";
import {
  getFilteredModels,
  ModelConfiguration,
  ModelLibrary, ModelType,
} from "../../../logic/models/modelLibrary";
import {
  ArrowDropDown,
  ArrowDropUp,
  Done,
  InfoOutlined,
  KeyboardArrowDown,
  KeyboardArrowUp,
  TuneOutlined,
  Search,
} from "@mui/icons-material";
import ToggleGenerationTypesGroup from "./ToggleGenerationTypesGroup";
import useFlowStore from "../../../logic/flowStore/flowStore";
import {memo, useCallback, useDeferredValue, useMemo, useState} from "react";
import ImportedIcon from "../../ImportedIcon";
import theme from "../../../themes";
import NodeDeleteButton from "../../Buttons/NodeDeleteButton";
import useViewport from "../../../logic/useViewport";
import {
  emptyModificationParams,
  modelConfigurationsBySize,
  Size,
  SIZES
} from "../../../logic/models/defaultParams";
import {Model, Provider} from "../../../logic/models/interfaces";
import {StyledPopover, styledSystemIcon, StyledButton, styledIcon} from "../../../themes/componentStyles";
import {isPromptNodeData, PriorityPair} from "../../../logic/flowStore/interfaces";
import NodeButton from "../../Buttons/NodeButton";
import EmojiObjectsIcon from "@mui/icons-material/EmojiObjects";
import usePromptNode from "./usePromptNode";
import PsychologyIcon from "@mui/icons-material/Psychology";

const isSameModelSet = (
  selected: ModelConfiguration[],
  defaults: ModelConfiguration[]
): boolean => {
  if (!selected || !defaults) return false;
  if (selected.length !== defaults.length) return false;

  const selectedNames = selected.map(m => m.name).sort();
  const defaultNames = defaults.map(m => m.name).sort();
  return selectedNames.every((name, i) => name === defaultNames[i]);
};

const isDefaultSize = (
  size: Size | undefined,
  activeType: ModelType,
  selected: ModelConfiguration[]
) => {
  const sizes = size ? [size] : SIZES;
  return sizes.some(s => {
    const defaults = modelConfigurationsBySize[s][activeType];
    return isSameModelSet(selected, defaults);
  });
};

const whatSize = (
  selected: ModelConfiguration[]
): Size | undefined => {
  for (const size of SIZES) {
    const config = modelConfigurationsBySize[size];

    const matchesSomeType = (Object.keys(config) as ModelType[]).some(type => {
      const defaults = config[type];
      return isSameModelSet(selected, defaults);
    });

    if (matchesSomeType) {
      return size;
    }
  }
  return undefined;
};

type ModelsBySizeProps = {
  nodeId: string;
  selectedModels: ModelConfiguration[];
  activeType: ModelType;
  isContained: boolean;
  isExecuted: boolean;
};

const ModelsBySize = ({
                        nodeId,
                        selectedModels,
                        activeType,
                        isContained,
                        isExecuted,
                      }: ModelsBySizeProps) => {
  const addModelToNode = useFlowStore.use.addModelToNode();
  const removeModelFromNode = useFlowStore.use.removeModelFromNode();
  const changeNodeRecentModelsList = useFlowStore.use.changeNodeRecentModelsList();

  const handleSizeClick = useCallback((size: Size) => {
    const isSize = isDefaultSize(size, activeType, selectedModels);
    if (isSize) {
      return;
    }
    selectedModels.forEach(m => removeModelFromNode(nodeId, m.name));
    modelConfigurationsBySize[size][activeType].forEach(m => {
      addModelToNode(nodeId, {
        type: m.type,
        name: m.name,
        params: emptyModificationParams,
      });
      changeNodeRecentModelsList(nodeId, m.name);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, selectedModels, activeType]);

  return isContained ? null : (
    <Stack width={"100%"} padding={"2px 0px"} alignItems="center">
      {
        SIZES.map((size) => {
          const isChosenSize = isDefaultSize(size, activeType, selectedModels);
          return (
            <React.Fragment key={size}>
              <Stack
                width="100%"
                height="40px"
                gap="4px"
                direction="row"
                padding={"8px"}
                alignItems={"center"}
                sx={{cursor: "pointer"}}
                justifyContent={"space-between"}
                onClick={() => {
                  if (isExecuted || modelConfigurationsBySize[size][activeType].length === 0) {
                    return;
                  }
                  handleSizeClick(size);
                }}
              >
                <Stack flexGrow={1} gap="4px" direction="row" alignItems={"center"}>
                  <Done
                    sx={{
                      width: "16px",
                      heigth: "16px",
                      color:
                        isChosenSize
                          ? "secondary.main"
                          : "transparent",
                    }}
                  />
                  <Typography variant="overline" letterSpacing={0} flexGrow={2}>
                    {size}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center" padding={"0 4px 0 0"}>
                  {modelConfigurationsBySize[size][activeType].map((m, idx) => (
                    <ImportedIcon
                      key={m.name + idx}
                      Icon={ModelLibrary.getModelByName(m.name)?.provider?.logoBig}
                      width="20px"
                    />
                  ))}
                </Stack>
              </Stack>
            </React.Fragment>
          )
        })}
    </Stack>
  );
};

type ShortModelsMenuProps = {
  nodeId: string;
  openParamsMenu: () => void;
  modelList: Model[];
  selectedModels: ModelConfiguration[];
  hasDivider?: boolean;
  padding?: string;
  isContained?: boolean;
  isExecuted?: boolean;
};

/**
 * ShortModelsMenu component
 * Renders a compact list of models for quick selection.
 */
const ShortModelsMenu = memo((
  {
    nodeId,
    openParamsMenu,
    modelList,
    selectedModels,
    hasDivider = false,
    padding = "0 16px",
    isContained = false,
    isExecuted = false
  }: ShortModelsMenuProps) => {
  const setSelectedModel = useFlowStore.use.setSelectedModel();
  const changeNodeRecentModelsList = useFlowStore.use.changeNodeRecentModelsList();
  const changeAreThoughtsShownForModel = useFlowStore.use.changeAreThoughtsShownForModel();
  const addModelToNode = useFlowStore.use.addModelToNode();
  const removeModelFromNode = useFlowStore.use.removeModelFromNode();
  const changeContainedNodeModelConfiguration = useFlowStore.use.changeContainedNodeModelConfiguration();

  const ensureModelAdded = useCallback((m: Model) => {
    if (isContained) {
      if (selectedModels[0]?.name !== m.name) {
        changeContainedNodeModelConfiguration(nodeId,
          {
            type: m.type,
            name: m.name,
            params: emptyModificationParams,
          });
        changeNodeRecentModelsList(nodeId, m.name);
      }
      return;
    }
    const exists = selectedModels.some(sel => sel.name === m.name) ?? false;
    if (!exists) {
      if ((selectedModels.length ?? 0) >= 4) {
        removeModelFromNode(nodeId, selectedModels[0]?.name);
      }
      addModelToNode(nodeId, {
        type: m.type,
        name: m.name,
        params: emptyModificationParams,
      });
      changeNodeRecentModelsList(nodeId, m.name);
    }
    return exists;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModels, addModelToNode, changeNodeRecentModelsList, nodeId, isContained, changeContainedNodeModelConfiguration]);

  const handleModelClick = useCallback((m: Model) => {
    const exists = ensureModelAdded(m);
    if (exists && (selectedModels.length ?? 0) > 1) {
      removeModelFromNode(nodeId, m.name);
    }
  }, [ensureModelAdded, removeModelFromNode, nodeId, selectedModels.length]);

  const handleOpenModelSettings = useCallback((e: React.MouseEvent, m: Model) => {
    e.stopPropagation();
    ensureModelAdded(m);
    setSelectedModel(m);
    openParamsMenu();
  }, [setSelectedModel, openParamsMenu, ensureModelAdded]);

  if (modelList.length === 0) return null;
  return (
    <Box>
      {modelList.map((m, index) => {
        const selectedConfig = selectedModels.find(sel => sel.name === m.name);
        const areThoughtsShown = selectedConfig?.areThoughtsShown ?? false;
        const isSelected = selectedConfig !== undefined;

        return (
          <React.Fragment key={`${m.name}-${index}`}>
            {hasDivider && <Divider/>}
            <Stack
              width="100%"
              height="40px"
              gap="4px"
              direction="row"
              padding={padding}
              alignItems={"center"}
              sx={{cursor: "pointer"}}
              onClick={() => {
                if (isExecuted) {
                  return;
                }
                handleModelClick(m);
              }}
            >
              <Done
                sx={{
                  width: "16px",
                  heigth: "16px",
                  color:
                    isSelected
                      ? "secondary.main"
                      : "transparent",
                }}
              />
              <ImportedIcon Icon={m.provider?.logoBig} width="24px"/>
              <Typography variant="overline" letterSpacing={0} flexGrow={2}>
                {m.name}
              </Typography>
              {m.type === "text" && (
                <NodeButton
                  icon={EmojiObjectsIcon}
                  func={(e: any) => {
                    if (isExecuted) {
                      return;
                    }
                    e.stopPropagation();
                    ensureModelAdded(m);
                    changeAreThoughtsShownForModel(nodeId, m, !areThoughtsShown);
                  }}
                  toolTipValue="Show thoughts"
                  color={areThoughtsShown ? "secondary" : "default"}
                  bgcolor={
                    areThoughtsShown
                      ? theme.palette.text.secondary
                      : undefined
                  }
                  sx={{
                    padding: "4px"
                  }}
                  iconSize="medium"
                />
              )}
              <IconButton
                onClick={(e) => {
                  handleOpenModelSettings(e, m)
                }}
                sx={{
                  width: "32px",
                  height: "32px",
                  padding: 0,
                  color: theme.palette.text.primary,
                  backgroundColor: "transparent",
                  borderRadius: "4px",
                  "&:hover": {
                    backgroundColor: theme.palette.background.default,
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <TuneOutlined sx={styledIcon}/>
              </IconButton>
            </Stack>
          </React.Fragment>
        );
      })}
    </Box>
  );
});

type ProviderModelsItemProps = {
  handleClose: () => void;
  nodeId: string;
  openParamsMenu: () => void;
  provider: Provider;
  modelList: Model[];
  selectedModels: ModelConfiguration[];
  isContained?: boolean;
};

/**
 * ProviderModelsItem component
 * Displays a provider row that can be expanded/collapsed to reveal its available models.
 */
const ProviderModelsItem = memo((props: ProviderModelsItemProps) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <Box>
      <Button
        disableRipple
        sx={{
          justifyContent: "left",
          width: "100%",
          color: "text.primary",
          backgroundColor: "transparent",
          paddingLeft: "16px",
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (<KeyboardArrowUp sx={styledSystemIcon}/>) : (<KeyboardArrowDown sx={styledSystemIcon}/>)}
        <Stack direction="row" gap="4px">
          {props.provider.logoBig && (<ImportedIcon Icon={props.provider.logoBig} width="24px"/>)}
          <Typography variant={"body2"} sx={{textTransform: "none"}}>
            {props.provider.provider}
          </Typography>
        </Stack>
      </Button>

      {isOpen &&
        <ShortModelsMenu
          key={`${props.provider.provider}-${props.nodeId}`}
          nodeId={props.nodeId}
          openParamsMenu={props.openParamsMenu}
          modelList={props.modelList}
          selectedModels={props.selectedModels}
          padding="0px 10px 0px 16px"
          isContained={props.isContained}
        />}
    </Box>
  );
});

type FullModelsMenuProps = {
  handleClose: () => void;
  nodeId: string;
  openParamsMenu: () => void;
  modelGroups: Map<Provider, Model[]>;
  modelList: Model[];
  selectedModels: ModelConfiguration[];
  recentModels: PriorityPair[];
  activeType: ModelType;
  onTypeChange: (type: ModelType) => void;
};

/**
 * FullModelsMenu component
 * Renders the full models selection menu with search, recent models, and expandable provider groups.
 */
function FullModelsMenu(props: FullModelsMenuProps) {
  const [value, setValue] = useState<string>("");
  const deferredValue = useDeferredValue(value);
  const filteredModels = useMemo(() => getFilteredModels(deferredValue, props.modelList), [deferredValue, props.modelList]);
  const getNodeData = useFlowStore.use.getNodeData();

  const data = (() => {
    const promptNodeData = getNodeData(props.nodeId);
    if (!promptNodeData || !isPromptNodeData(promptNodeData)) return null;
    return promptNodeData;
  })();

  if (props.modelList.length === 0) return null;
  return (
    <Box>
      <ModelsBySize
        nodeId={props.nodeId}
        selectedModels={props.selectedModels}
        activeType={props.activeType}
        isContained={data?.isContained ?? false}
        isExecuted={data?.isExecuted ?? false}
      />
      <Divider/>
      <Box height={20} paddingLeft="16px" margin="8px 0px">
        <Search
          sx={{
            width: "18px",
            height: "18px",
            color: "text.secondary",
            marginRight: "4px",
          }}
        />
        <InputBase
          value={value}
          onChange={(e) => setValue(e.target.value)}
          sx={{
            ...theme.typography.body2,
            height: "20px",
            width: "calc(100% - 54px)",
            position: "absolute",
            padding: "0",
            "& ::placeholder": {
              color: "text.secondary",
            },
          }}
          placeholder="Name of AI model"
        />
      </Box>
      <Divider/>
      <Box
        className="styled-scrollbars"
        sx={{maxHeight: "200px", overflowY: "scroll"}}
        padding="0 0 16px 0"
      >
        {value.length > 0 ? (
          <ShortModelsMenu
            nodeId={props.nodeId}
            openParamsMenu={props.openParamsMenu}
            modelList={filteredModels}
            selectedModels={props.selectedModels}
            isContained={data?.isContained ?? false}
          />
        ) : (
          <Stack
            sx={{
              direction: "column",
              justifyContent: "center",
              paddingTop: "8px",
            }}
          >
            {Array.from(props.modelGroups).map((v, index) => (
              <ProviderModelsItem
                key={index}
                handleClose={props.handleClose}
                nodeId={props.nodeId}
                openParamsMenu={props.openParamsMenu}
                provider={v[0]}
                modelList={v[1]}
                selectedModels={props.selectedModels}
                isContained={data?.isContained ?? false}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

type ModelSelectMenuProps = {
  nodeId: string;
  selectedModels: ModelConfiguration[];
  openModelParamsMenu: (id: string) => void;
  openParamsMenu: () => void;
  recentModelsList: PriorityPair[];
  activeType: ModelType;
  onTypeChange: (type: ModelType) => void;
};

/**
 * ModelSelectMenu component
 * Opens a popover menu to pick a model, configure parameters.
 */
function ModelSelectMenu(props: ModelSelectMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const {getViewport} = useViewport();
  const {zoom} = getViewport();

  const handleClick = useCallback((event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget), []);
  const handleClose = useCallback(() => setAnchorEl(null), []);

  const modelsByType = useMemo(() => {
    return ModelLibrary.getModelsByType(props.activeType);
  }, [props.activeType]);

  const providerGroups = useMemo(() => {
    return ModelLibrary.getProviderGroupsByType(props.activeType);
  }, [props.activeType]);

  const safeSelectedModels = useMemo(() => {
    return Array.isArray(props.selectedModels) ? props.selectedModels : [];
  }, [props.selectedModels]);

  const changeAreThoughtsShown = useFlowStore.use.changeAreThoughtsShown();
  const getNodeData = useFlowStore.use.getNodeData();
  const {copyAndAggregate} = usePromptNode();

  const data = (() => {
    const promptNodeData = getNodeData(props.nodeId);
    if (!promptNodeData || !isPromptNodeData(promptNodeData)) return null;
    return promptNodeData;
  })();

  return (
    <div className="nodrag">
      <StyledButton
        variant="outlined"
        onClick={
          data?.isExecuted ?
            props.openParamsMenu
            : handleClick
        }
        startIcon={
          safeSelectedModels.length === 1 ? (
            <ImportedIcon
              Icon={ModelLibrary.getModelByName(safeSelectedModels[0]?.name)?.provider?.logoBig}
              width="24px"
            />
          ) : undefined
        }
        endIcon={
          data?.isExecuted
            ? (<InfoOutlined sx={styledSystemIcon}/>)
            : open ? (<ArrowDropUp sx={styledSystemIcon}/>)
              : (<ArrowDropDown sx={styledSystemIcon}/>)
        }
        sx={{
          color: "text.primary",
          borderColor: data?.isExecuted
            ? "secondary.contrastText"
            : open
              ? "secondary.main"
              : "text.primary",
          padding: data?.isExecuted ? "0px 0px 0px 10px" : "0px 0px 0px 8px",
          textTransform: "none",
          "&:disabled": {
            border: "transparent",
            color: "text.primary",
          },
          "&:hover": {
            borderColor: data?.isExecuted ? "text.primary" : "none",
            backgroundColor: data?.isExecuted ? "transparent" : "secondary.light",
            color: "text.primary",
          },
          "& .MuiButton-endIcon": {
            paddingLeft: isDefaultSize(undefined, props.activeType, props.selectedModels) || data?.isExecuted ? "12px" :
              safeSelectedModels.length === 1 ? "8px" : "4px",
            marginRight: isDefaultSize(undefined, props.activeType, props.selectedModels) ? "-4px" : "0px",
            marginLeft: "0px",
          },
        }}
      >
        {whatSize(safeSelectedModels) ?
          <Typography variant="overline" letterSpacing={0} textTransform="capitalize">
            {whatSize(safeSelectedModels)}
          </Typography>
          : (!safeSelectedModels || safeSelectedModels.length === 0) ? (
            <Typography variant="overline" letterSpacing={0} textTransform={"capitalize"}>
              No model selected
            </Typography>
          ) : safeSelectedModels.length > 1 ? (
            <Stack direction="row" spacing={1} alignItems="center" padding={"0 4px 0 0"}>
              {safeSelectedModels.slice(0, 6).map((m, idx) => (
                <ImportedIcon
                  key={m.name + idx}
                  Icon={ModelLibrary.getModelByName(m.name)?.provider?.logoBig}
                  width="20px"
                />
              ))}
              {safeSelectedModels.length > 6 && (
                <Typography variant="overline" letterSpacing={0} textTransform={"capitalize"}>
                  +{props.selectedModels?.length - 6}
                </Typography>
              )}
            </Stack>
          ) : (
            safeSelectedModels[0]?.name
          )}
      </StyledButton>
      <StyledPopover
        zoom={zoom}
        anchorOrigin={{vertical: "top", horizontal: "right",}}
        transformOrigin={{vertical: 17, horizontal: "left",}}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
      >
        <Stack>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            padding={"16px"}
          >
            <Typography
              variant="subtitle2"
              letterSpacing={0}
              flexGrow={2}
            >
              Prompt Settings
            </Typography>

            <Stack gap={"4px"} direction="row" flexGrow={1} alignItems={"center"} justifyContent="flex-end">
              {safeSelectedModels.some((m) => m.type === "text") && (
                <NodeButton
                  icon={EmojiObjectsIcon}
                  func={() => {
                    if (data?.isExecuted) {
                      return;
                    }
                    changeAreThoughtsShown(props.nodeId, !data?.areThoughtsShown || false)
                  }}
                  toolTipValue="Show thoughts"
                  color={data?.areThoughtsShown ? "secondary" : "default"}
                  bgcolor={
                    (data?.isExecuted && data?.areThoughtsShown)
                      ? theme.palette.text.secondary
                      : undefined
                  }
                  sx={{
                    padding: "4px"
                  }}
                  iconSize="medium"
                  disabled={data?.isExecuted}
                />
              )}

              {!data?.isAggregateNode && !data?.isContained && (
                <NodeButton
                  icon={PsychologyIcon}
                  func={() => {
                    if (data?.isExecuted) {
                      return;
                    }
                    copyAndAggregate(props.nodeId)
                  }}
                  toolTipValue="Add Think Tank"
                  color={"default"}
                  sx={{padding: "4px"}}
                  iconSize="medium"
                  disabled={data?.isExecuted}
                />)}
              <NodeDeleteButton func={handleClose} toClose={true}/>
            </Stack>
          </Stack>
          <Divider/>

          <Stack
            direction={"row"}
            justifyContent={"space-between"}
            padding="8px 16px"
          >
            <ToggleGenerationTypesGroup
              isExecuted={data?.isExecuted ?? false}
              nodeId={props.nodeId}
              models={safeSelectedModels}
              onTypeChange={props.onTypeChange}
              activeType={props.activeType}
            />
          </Stack>
          <Divider/>
          <FullModelsMenu
            handleClose={handleClose}
            nodeId={props.nodeId}
            openParamsMenu={() => {
              props.openModelParamsMenu(props.nodeId);
            }}
            modelGroups={providerGroups}
            modelList={modelsByType}
            selectedModels={safeSelectedModels}
            recentModels={props.recentModelsList}
            onTypeChange={props.onTypeChange}
            activeType={props.activeType}
          />
        </Stack>
      </StyledPopover>
    </div>
  );
}

export default memo(ModelSelectMenu);
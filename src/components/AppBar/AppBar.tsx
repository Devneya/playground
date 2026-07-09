import React, { memo } from "react";
import {
  Avatar,
  CircularProgress,
  IconButton,
  Stack,
  Typography
} from "@mui/material";
import { useContext, useEffect, useRef, useState } from "react";
import { StyledAppBarStack, VisuallyHiddenInput } from "../../themes/componentStyles";
import {
  Attachment,
  DeleteOutline,
  DownloadOutlined, SnippetFolder,
  PersonOutline,
  SmartButton,
  DashboardCustomize
} from "@mui/icons-material";
import {
  SessionContext,
  VirtualKeyContext,
} from "../../context/supabaseContext";
import DeletePopover from "../DeletePopover";
import SystemIconButton from "../Buttons/SystemIconButton";
import useAppBar from "./useAppBar";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { supabase } from "../../supabase";
import theme from "../../themes";
import { defaultModelConfigurations, XSSizeModelConfiguration } from "../../logic/models/defaultParams";
import { OpenWithIcon } from "../Nodes/PromptNode/ModelHeader";
import { useAvatar } from "../../logic/utils";
import useCanvas from "../Space/useCanvas";

type FlowAppBarProps = {
  openAccountMenuModal: () => void;
  avatarPath?: string;
  onOpenCanvasList: (value: boolean) => void;
  onOpenTemplates: () => void;
};

const FlowAppBarComponent: React.FC<FlowAppBarProps> = (props) => {
  const virtualKey = useContext(VirtualKeyContext);
  const contentImport = useRef<HTMLInputElement | null>(null); // import content from local files
  const session = useContext(SessionContext);

  const [userName, setUserName] = useState<string | null>(null);
  const { addNewNodeOnView, handleFileChange, clearFlow, exportContent, isExporting } = useAppBar();
  const { handleBeforeOpenSpace } = useCanvas();
  const [suggestEnterName, setSuggestEnterName] = useLocalStorage("suggest_to_enter_name", "");
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [isLoadingCanvasList, setIsLoadingCanvasList] = useState(false);
  const handleDeleteButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(anchorEl ? null : event.currentTarget);
  };
  const deleteFlowPopoverOpened = Boolean(anchorEl);

  useEffect(() => {
    const loadUserName = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error !== null || data === null) {
        console.log(error);
        return;
      }
      setUserName(data.user.user_metadata.name);
    };
    loadUserName();
  }, []);
  const avatarUrl = useAvatar(props.avatarPath);

  return (
    <Stack
      direction={"row"}
      justifyContent={"space-around"}
      position="sticky"
      height="auto"
      sx={{
        zIndex: 500,
        margin: "20px 20px 0",
        minWidth: "500px",
        display: "flex",
        justifyContent: "space-between",
        pointerEvents: "none",
      }}
    >
      <Stack direction="column" gap={"20px"} alignItems={"center"}>
        <StyledAppBarStack sx={{ padding: "3px" }}>
          <SystemIconButton
            func={async () => {
              setIsLoadingCanvasList(true);
              try {
                await handleBeforeOpenSpace();
                props.onOpenCanvasList(true);
              } finally {
                setIsLoadingCanvasList(false);
              }
            }}
            icon={SnippetFolder}
            toolTipValue={"Canvases"}
            isLoading={isLoadingCanvasList}
          />
        </StyledAppBarStack>

        <StyledAppBarStack>
          <SystemIconButton
            func={() =>
              addNewNodeOnView(
                "prompt",
                undefined,
                undefined,
                undefined,
                {
                  isExecuted: false,
                  prompt: "",
                  selectedModels: [defaultModelConfigurations.text],
                  recentModelsList: [{
                    priority: 0,
                    value: defaultModelConfigurations.text.name,
                  }],
                  areThoughtsShown: false,
                }
              )
            }
            icon={SmartButton}
            toolTipValue={"Create 1 model prompt"}
          />

          <SystemIconButton
            icon={OpenWithIcon}
            func={() => addNewNodeOnView(
              "prompt",
              undefined,
              undefined,
              undefined,
              {
                isExecuted: false,
                prompt: "",
                selectedModels:
                  [...XSSizeModelConfiguration.text],
                recentModelsList:
                  XSSizeModelConfiguration.text.map((m, index) => ({
                    value: m.name,
                    priority: index,
                  })),
                areThoughtsShown: false
              }
            )}
            toolTipValue={"Create 4 models prompt"}
          />

          <SystemIconButton
            func={() => contentImport.current?.click()}
            icon={Attachment}
            toolTipValue={"Add content"}
            contentBelow={
              <VisuallyHiddenInput
                ref={contentImport}
                onChange={(e) => handleFileChange(e, session!.user.id)}
                type="file"
                id="content-input"
                accept=".jpg,.jpeg,.png,.txt,.md,.mp3,.wav,.ogg,.m4a,.pdf"
              />
            }
          />

          <SystemIconButton
            func={props.onOpenTemplates}
            icon={DashboardCustomize}
            toolTipValue={"Templates"}
          />
        </StyledAppBarStack>
        <StyledAppBarStack>
          <SystemIconButton
            func={exportContent}
            icon={DownloadOutlined}
            toolTipValue={"Export flow"}
            isLoading={isExporting}
          />

          <SystemIconButton
            func={handleDeleteButtonClick}
            icon={DeleteOutline}
            toolTipValue={"Clear flow"}
            color="error"
          />
        </StyledAppBarStack>
        <DeletePopover
          actionCallback={async () => await clearFlow(session!.access_token)}
          open={deleteFlowPopoverOpened}
          anchorEl={anchorEl}
          setAnchorEl={setAnchorEl}
          centered={false}
          label={"Delete all blocks?"}
        />
        {(virtualKey === null || virtualKey === "") &&
          <CircularProgress size={30} sx={{ color: "primary.contrastText" }} />
        }
      </Stack>
      <Stack
        direction="row"
        position={"relative"}
        onClick={() => {
          // If the user is visiting the site for the first time and logged in via email, we don't have their name.
          // We ask the user to provide it until they click on the prompt.
          // If they clicked on the prompt and didn't enter a name, we stop asking.
          setSuggestEnterName(false);
          props.openAccountMenuModal();
        }}
      >
        {suggestEnterName && (userName === "" || userName === undefined) &&
          <Typography
            position={"absolute"}
            left="-208px"
            top="-6px"
            sx={{ pointerEvents: "all", cursor: "pointer" }}
            width="200px"
            bgcolor="white"
            borderRadius="8px"
            height="fit-content"
            lineHeight={"24px"}
            p={"4px 16px"}
            fontSize={"13px"}
          >
            {"👋 Hey, Stranger! Would you mind to introduce yourself?"}
          </Typography>
        }
        <IconButton
          sx={{
            pointerEvents: "all",
            width: "44px",
            height: "44px",
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            boxShadow: "0 0 2px 1px rgba(0, 0, 0, 0.08)",
            "&:hover": {
              boxShadow: "0 1px 4px 1px rgba(0, 0, 0, 0.08)",
            },
          }}>
          <Avatar
            src={avatarUrl ?? undefined}
            sx={{
              width: "44px",
              height: "44px",
              backgroundColor: theme.palette.background.paper,
              color: theme.palette.text.primary,
            }}
          >
            {!avatarUrl && <PersonOutline />}
          </Avatar>
        </IconButton>
      </Stack>
    </Stack>
  );
};

// Wrap the functional component with React.memo
export default memo(FlowAppBarComponent);
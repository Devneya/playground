import {Stack, keyframes} from "@mui/material";
import {memo, useContext, useEffect, useState} from "react";
import NodeButton from "./NodeButton";
import DocumentScannerIcon from "@mui/icons-material/DocumentScanner";
import useFlowStore from "../../logic/flowStore/flowStore";
import usePromptNode from "../Nodes/PromptNode/usePromptNode";
import {ModelLibrary} from "../../logic/models/modelLibrary";
import theme from "../../themes";
import {Model} from "../../logic/models/interfaces";
import {VirtualKeyContext} from "../../context/supabaseContext";
import {useSnackbar} from "notistack";

type ContentType = "audio" | "pdf" | "image";

export type ContentAction = {
  id: string;
  label: string;
  contentType: ContentType;
  description: string;
  model: Model;
};

const CONTENT_ACTIONS: ContentAction[] = [
  {
    id: "audio_transcribe",
    label: "Voice to text",
    contentType: "audio",
    description: "Convert audio to text",
    model: ModelLibrary.getModelByName("whisper-1")!
  },
  {
    id: "pdf_vision",
    label: "PDF to text",
    contentType: "pdf",
    description: "Vision the document",
    model: ModelLibrary.getModelByName("Llama-4-Scout-17B-16E-Instruct")!
  },
  {
    id: "image_vision",
    label: "Image to text",
    contentType: "image",
    description: "Vision the image",
    model: ModelLibrary.getModelByName("Llama-4-Scout-17B-16E-Instruct")!
  },
];

const pulse = keyframes`
    0% {
        box-shadow: 0 0 0 0 ${theme.palette.secondary.light};
    }
    70% {
        box-shadow: 0 0 0 4px ${theme.palette.secondary.light};
    }
    100% {
        box-shadow: 0 0 0 0 ${theme.palette.secondary.light};
    }
`;

type ContentNodeActionButtonProps = {
  nodeId: string;
  contentType: ContentType;
};

const ContentNodeActionButton = ({nodeId, contentType}: ContentNodeActionButtonProps) => {
  const transcribeAudio = useFlowStore.use.transcribeAudio();
  const visionPdfOrImage = useFlowStore.use.visionPdfOrImage();
  const {getNewContentNodePosition, autoViewForRequest} = usePromptNode();
  const [isPulsing, setIsPulsing] = useState(true);
  const virtualKey = useContext(VirtualKeyContext);
  const {enqueueSnackbar} = useSnackbar();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsPulsing(false);
    }, 4200);
    return () => clearTimeout(timeout);
  }, []);

  const action = CONTENT_ACTIONS.find(action => action.contentType === contentType);
  if (!action) {
    return null;
  }

  function handleAction() {
    try {
      if (!action || !virtualKey) {
        return;
      }
      if (contentType === "audio") {
        transcribeAudio(nodeId, action, getNewContentNodePosition, virtualKey);
        autoViewForRequest(nodeId);
        return;
      } else {
        visionPdfOrImage(nodeId, action, getNewContentNodePosition, virtualKey);
        autoViewForRequest(nodeId);
        return;
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : JSON.stringify(error);
      enqueueSnackbar(message, {variant: "error"});
    }
  }

  const iconComponent = DocumentScannerIcon;

  return (
    <Stack
      direction="row"
      alignItems="center"
      sx={{height: "32px"}}
    >
      <NodeButton
        func={handleAction}
        icon={iconComponent}
        toolTipValue={action.label}
        iconSize="small"
        sx={{
          position: "relative",
          height: "32px",
          width: "32px",
          padding: "2px",
          border: `1px solid ${theme.palette.secondary.main}`,
          backgroundColor: "transparent",

          "& svg": {
            fontSize: "18px",
            position: "relative",
            zIndex: 9,
          },
          ...(isPulsing && {
            animation: `${pulse} 1.4s ease-in-out infinite`,
          }),
        }}
      />
    </Stack>
  );
};

export default memo(ContentNodeActionButton);

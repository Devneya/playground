import OpenAI from "openai";
import {ContentAction} from "../../../Buttons/ContentNodeActionButton";
import {downloadFile} from "../../../../storage";

type MakeTranscriptionProps = {
  filePath: string;
  action: ContentAction;
  virtualKey: string;
};

export const makeTranscriptionRequest = async (props: MakeTranscriptionProps) => {
  try {
    if (props.action.model?.type !== "audio") {
      throw new Error("Audio model required");
    }
    const blob = await downloadFile(props.filePath);
    if (blob instanceof Error) {
      throw blob;
    }

    const filename = decodeURIComponent(props.filePath.split("/").pop() ?? "audio");
    const file = new File([blob], filename, {type: blob.type});

    const client = new OpenAI({
      baseURL: `${import.meta.env.VITE_LITELLM_URL || ""}`,
      apiKey: props.virtualKey,
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
    });
    return props.action.model.requestCallback(client, {file});
  } catch (err) {
    console.error("Audio transcription failed:", err);
    throw new Error(`Audio transcription failed: ${err}`);
  }
};


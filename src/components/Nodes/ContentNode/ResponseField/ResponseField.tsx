import {Box} from "@mui/material";
import {
  ContentResponse, isAudioResponse,
  isImageResponse, isPdfResponse,
  isTextResponse,
} from "../../../../logic/flowStore/interfaces";
import ImageResponseField from "./ImageResponseField";
import React, {useEffect} from "react";
import {HeadingNode, QuoteNode} from "@lexical/rich-text";
import {ListItemNode, ListNode} from "@lexical/list";
import {CodeNode} from "@lexical/code";
import {LinkNode} from "@lexical/link";
import {$getRoot} from "lexical";
import {$convertFromMarkdownString, TRANSFORMERS} from "@lexical/markdown";
import {LexicalComposer} from "@lexical/react/LexicalComposer";
import {ContentEditable} from "@lexical/react/LexicalContentEditable";
import {HistoryPlugin} from "@lexical/react/LexicalHistoryPlugin";
import {MarkdownShortcutPlugin} from "@lexical/react/LexicalMarkdownShortcutPlugin";
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import theme from "../../../../themes";
import {ProcessingAnimation} from "../../ProcessingAnimation";
import AudioResponseField from "./AudioResponseField";
import {PdfResponseField} from "./PdfResponseField";

type ResponseFieldProps = {
  nodeId: string;
  response: ContentResponse;
  loading: boolean;
  isRegenerated?: boolean;
  containerNodeId?: string;
  previousAgentResponse?: string;
  responseRef: React.RefObject<HTMLDivElement>;
};

const MarkdownEditor: React.FC<{
  initialText: string;
  hasThinking?: boolean;
  textRef: React.RefObject<HTMLDivElement | null>;
}> = ({initialText, hasThinking, textRef}) => {
  const initialConfig = {
    namespace: "MarkdownEditor",
    theme: {
      ltr: "ltr",
      text: {
        bold: "bold-text",
        italic: "italic-text",
        underline: "underline-text",
      },
    },
    nodes: [HeadingNode, ListNode, ListItemNode, QuoteNode, CodeNode, LinkNode],
    onError: (error: Error) => console.error(error),
    editable: false,
  };

  return (
    <Box
      className="nowheel styled-scrollbars"
      sx={{
        overflowY: "scroll",
        color: "text.primary",
        zIndex: 4,
        padding: "4px",
        boxSizing: "border-box",
        height: "100%",
      }}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <MarkdownContent initialText={initialText} textRef={textRef}/>
      </LexicalComposer>
    </Box>
  );
};

const MarkdownContent: React.FC<{
  initialText: string;
  textRef: React.RefObject<HTMLDivElement | null>;
}> = ({initialText, textRef}) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const nodes = $convertFromMarkdownString(initialText, TRANSFORMERS);
      if (Array.isArray(nodes)) {
        nodes.forEach((node) => {
          if (node) {
            root.append(node);
          }
        });
      }
    });
  }, [initialText, editor]);

  return (
    <div
      style={{
        ...theme.typography.body1,
        border: "none",
        padding: "0",
        borderRadius: "0",
        overflow: "visible",
        boxSizing: "border-box",
      }}
      className="rich-text"
      ref={textRef}
    >
      <ContentEditable
        style={{
          pointerEvents: "auto",
          userSelect: "text",
        }}
      />
      <HistoryPlugin/>
      <MarkdownShortcutPlugin transformers={TRANSFORMERS}/>
    </div>
  );
};

const ResponseFieldComponent: React.FC<ResponseFieldProps> = (props) => {
  return props.loading ? (
    <ProcessingAnimation/>
  ) : isTextResponse(props.response) ? (
    <Box padding={"8px"} width={"100%"} height={"calc(100% - 58px)"}>
      <MarkdownEditor
        initialText={props.response.text}
        hasThinking={!!props.response.thinking}
        textRef={props.responseRef}
      />
    </Box>
  ) : isAudioResponse(props.response) ? (
    <Box padding={"8px"} width="100%" flex={1}
         display="flex">
      <AudioResponseField audio={props.response}/>
    </Box>
  ) : isPdfResponse(props.response) ? (
    <Box width="100%" height="calc(100% - 64px)">
      <PdfResponseField path={props.response.path}/>
    </Box>
  ) : isImageResponse(props.response) ? (
    <Box
      sx={{
        backgroundColor: "background.default",
        border: `2px solid ${theme.palette.text.disabled}`,
      }}
      width="100%"
      height="calc(100% - 100px)"
    >
      <ImageResponseField path={props.response.path}/>
    </Box>
  ) : null;
};

// Wrap the functional component with React.memo
export const ResponseField = React.memo(ResponseFieldComponent);

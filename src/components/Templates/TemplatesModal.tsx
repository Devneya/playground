import React, { useState, useRef, memo, useCallback, useEffect } from "react";
import {
  Box,
  IconButton,
  Modal,
  Stack,
  Tooltip,
  Typography,
  useTheme,
  CircularProgress, alpha,
} from "@mui/material";
import {
  DownloadOutlined,
  MoreVert,
  ExpandMore,
  ExpandLess,
  NoteOutlined,
} from "@mui/icons-material";
import { StyledAppBarStack } from "../../themes/componentStyles";
import {
  getAllTemplateMetadata,
  loadTemplate,
  preloadTemplates,
  loadTemplatesScreenshots
} from "./templateLoader";
import CanvasActionButton from "../Space/CanvasActionButton";
import NodeDeleteButton from "../Buttons/NodeDeleteButton";
import { useSnackbar } from "notistack";
import useFlowStore from "../../logic/flowStore/flowStore";
import { DEFAULT_PROMPT_NODE_SIZE } from "../../config/nodeSize";
import {
  Template,
  TemplateMetadata,
  isPromptNodeData,
  isContentNodeData,
  isContainerNodeData,
} from "../../logic/flowStore/interfaces";
import usePromptNode from "../Nodes/PromptNode/usePromptNode";
import useContentNode from "../Nodes/ContentNode/useContentNode";
import useViewport from "../../logic/useViewport";
import { animateViewport } from "../../logic/useViewport";
import { flushSync } from "react-dom";

const searchStep = 100;
const positionPadding = 50;
const viewportPadding = 50;
const overlapPadding = 20;

type TemplatesModalProps = {
  open: boolean;
  onClose: () => void;
};

type TemplateCardProps = {
  template: Template | TemplateMetadata;
  onAddToCanvas: (templateId: string) => void;
  onExport: (templateId: string) => Promise<void>;
  expandedCardId: string | null;
  onToggleExpand: (cardId: string) => void;
  loadingTemplates: Set<string>
};

const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  onAddToCanvas,
  onExport,
  expandedCardId,
  onToggleExpand,
  loadingTemplates
}) => {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const [isTextTruncated, setIsTextTruncated] = useState(false);
  const expanded = expandedCardId === template.id;
  const menuRef = useRef<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const screenshotBase64 = 'screenshotBase64' in template ? template.screenshotBase64 : undefined;
    if (screenshotBase64) {
      setScreenshotUrl(
        screenshotBase64.startsWith("data:image")
          ? screenshotBase64
          : `data:image/png;base64,${screenshotBase64}`
      );
    } else {
      setScreenshotUrl(null);
    }
  }, [template]);

  useEffect(() => {
    const checkTruncation = () => {
      if (descriptionRef.current && !expanded) {
        const element = descriptionRef.current;
        const isTruncated = element.scrollHeight > element.clientHeight;
        setIsTextTruncated(isTruncated);
      }
    };

    if (!expanded) {
      checkTruncation();
      const resizeObserver = new ResizeObserver(checkTruncation);
      if (descriptionRef.current) {
        resizeObserver.observe(descriptionRef.current);
      }

      return () => {
        resizeObserver.disconnect();
      };
    } else {
      setIsTextTruncated(true);
    }
  }, [template.description, expanded]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        menuOpen &&
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(target) &&
        !buttonRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [menuOpen]);

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!expanded && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      let parent = cardRef.current.parentElement;
      while (parent && parent !== document.body) {
        const computedStyle = window.getComputedStyle(parent);
        if (computedStyle.display === 'grid' || computedStyle.display === 'inline-grid') {
          const containerRect = parent.getBoundingClientRect();
          const position = {
            left: rect.left - containerRect.left,
            top: rect.top - containerRect.top,
            width: rect.width,
          };
          flushSync(() => {
            setCardPosition(position);
          });
          onToggleExpand(template.id);
          return;
        }
        parent = parent.parentElement;
      }
    } else {
      setCardPosition(null);
      onToggleExpand("");
    }
  };

  const handleImageClick = async () => {
    await onAddToCanvas(template.id);
  };

  return (
    <>
      {expanded && (
        <Box
          sx={{
            visibility: "hidden",
            height: "300px",
            gridColumn: "span 1",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        />
      )}
      <Box
        ref={cardRef}
        sx={{
          position: expanded && cardPosition ? "absolute" : "relative",
          borderRadius: "12px",
          overflow: "visible",
          backgroundColor: "background.paper",
          border: `1px solid ${theme.palette.background.default}`,
          pointerEvents: "auto",
          isolation: "isolate",
          zIndex: expanded ? 10 : 1,
          width: expanded && cardPosition ? `${cardPosition.width}px` : "100%",
          maxWidth: "100%",
          ...(expanded && cardPosition ? {
            left: `${cardPosition.left}px`,
            top: `${cardPosition.top}px`,
          } : {}),
          boxShadow: expanded
            ? "0 4px 12px 2px rgba(0, 0, 0, 0.15)"
            : "none",
          "&:hover": {
            boxShadow: expanded
              ? "0 4px 12px 2px rgba(0, 0, 0, 0.15)"
              : "0 1px 4px 1px rgba(0, 0, 0, 0.08)",
          },
        }}
      >
        <Box
          onClick={handleImageClick}
          sx={{
            aspectRatio: "1.41 / 1",
            backgroundColor: "background.default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: "12px 12px 0 0",
            position: "relative",
            zIndex: 1,
            cursor: "pointer",
          }}
        >
          {loadingTemplates.has(template.id) && (
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: alpha(theme.palette.background.paper, 0.7),
                zIndex: 10,
                borderRadius: "12px 12px 0 0",
              }}
            >
              <CircularProgress size={32} sx={{ color: "text.secondary" }} />
            </Box>
          )}
          {screenshotUrl ? (
            <Box
              component="img"
              src={screenshotUrl}
              alt={template.name}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                pointerEvents: "none",
                backgroundColor: "background.default",
              }}
            />
          ) : (
            <NoteOutlined
              sx={{
                color: "grey.400",
                fontSize: 48,
                pointerEvents: "none",
              }}
            />
          )}
        </Box>

        <Box sx={{ padding: "12px", position: "relative", zIndex: 2, }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              gap: "8px",
            }}
          >
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0px",
              }}
            >
              <Typography variant="body1" noWrap>
                {template.name}
              </Typography>
              <Box
                sx={{
                  position: "relative",
                  minHeight: "2.8em",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-end",
                }}
              >
                <Typography
                  ref={descriptionRef}
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    overflow: expanded ? "visible" : "hidden",
                    textOverflow: expanded ? "clip" : "ellipsis",
                    display: expanded ? "block" : "-webkit-box",
                    WebkitLineClamp: expanded ? undefined : 2,
                    WebkitBoxOrient: "vertical",
                    lineHeight: "1.4",
                    minHeight: expanded ? "auto" : "2.8em",
                  }}
                >
                  {template.description}
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                alignSelf: "stretch",
                gap: "4px",
                pointerEvents: "auto",
              }}
            >
              <Box sx={{ position: "relative", paddingRight: "3px", }}>
                <Tooltip title="Actions" placement="bottom" arrow disableInteractive>
                  <IconButton
                    ref={(el) => {
                      buttonRef.current = el;
                    }}
                    size="small"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuOpen(!menuOpen);
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    disableRipple
                    disableFocusRipple
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1,
                      cursor: "pointer",
                      backgroundColor: "transparent",
                      color: "text.primary",
                      "&:hover": {
                        backgroundColor: "background.default",
                      },
                    }}
                  >
                    <MoreVert fontSize="small" />
                  </IconButton>
                </Tooltip>

                {menuOpen && (
                  <Box
                    ref={(el) => {
                      menuRef.current = el as HTMLElement | null;
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    sx={{
                      position: "absolute",
                      bottom: "calc(100% + 8px)",
                      right: "0",
                      zIndex: 40,
                      pointerEvents: "auto",
                    }}
                  >
                    <StyledAppBarStack direction="column" sx={{ pointerEvents: "auto", padding: "3px" }}>
                      <CanvasActionButton
                        icon={DownloadOutlined}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setMenuOpen(false);
                          await onExport(template.id);
                        }}
                        tooltipValue="Export JSON"
                        tooltipPlacement="right"
                      />
                    </StyledAppBarStack>
                  </Box>
                )}
              </Box>
              {(expanded || isTextTruncated) && (
                <Box sx={{ position: "relative", paddingRight: "3px", }}>
                  <IconButton
                    size="small"
                    onClick={handleToggleExpand}
                    sx={{
                      width: 24,
                      height: 24,
                      color: "text.secondary",
                      "&:hover": {
                        backgroundColor: "background.default",
                      },
                    }}
                  >
                    {expanded ? (
                      <ExpandLess fontSize="small" />
                    ) : (
                      <ExpandMore fontSize="small" />
                    )}
                  </IconButton>
                </Box>
              )}
            </Box>
          </Box>
        </Box>

      </Box>
    </>
  );
};

/**
 * TemplatesModal component displays all available templates in a grid layout
 */
const TemplatesModal: React.FC<TemplatesModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const [templates, setTemplates] = useState<(Template | TemplateMetadata)[]>([]);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState<Set<string>>(new Set());
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const getStoreViewport = useFlowStore.use.getStoreViewport();
  const getNodeSize = useFlowStore.use.getNodeSize();
  const addPromptNode = useFlowStore.use.addPromptNode();
  const addContentNode = useFlowStore.use.addContentNode();
  const addContainerNode = useFlowStore.use.addContainerNode();
  const addNewEdge = useFlowStore.use.addNewEdge();
  const { computeBoundingBox } = usePromptNode();
  const { initiateDownload } = useContentNode();
  const { getViewport, setViewport } = useViewport();

  // Load metadata and screenshots when modal opens
  useEffect(() => {
    if (!open) return;

    const loadData = async () => {
      try {
        setLoadingMetadata(true);
        const manifestUrl = import.meta.env.VITE_TEMPLATES_INDEX_URL;
        if (!manifestUrl) {
          throw new Error("Templates index URL is not configured");
        }
        await preloadTemplates(manifestUrl);
        await loadTemplatesScreenshots();
        const metadata = getAllTemplateMetadata();
        setTemplates(metadata);
      } catch (error) {
        console.error("Failed to load templates data:", error);
      } finally {
        setLoadingMetadata(false);
      }
    };

    loadData();
  }, [open, enqueueSnackbar]);

  const checkOverlap = useCallback((x: number, y: number, width: number, height: number): boolean => {
    const padding = overlapPadding;
    const templateRight = x + width;
    const templateBottom = y + height;

    const nodes = useFlowStore.getState().nodes;
    for (const node of nodes) {
      const nodeWidth = node.width || getNodeSize(node.id).width || DEFAULT_PROMPT_NODE_SIZE.width;
      const nodeHeight = node.height || getNodeSize(node.id).height || DEFAULT_PROMPT_NODE_SIZE.height;
      const nodeRight = node.position.x + nodeWidth;
      const nodeBottom = node.position.y + nodeHeight;

      if (
        x < nodeRight + padding &&
        templateRight + padding > node.position.x &&
        y < nodeBottom + padding &&
        templateBottom + padding > node.position.y
      ) {
        return true;
      }
    }
    return false;
  }, [getNodeSize]);

  const findEmptyPlace = useCallback((templateNodes: any[]) => {
    if (templateNodes.length === 0) {
      const viewport = getStoreViewport() || { x: 0, y: 0, zoom: 0.9 };
      const { x, y, zoom } = viewport;
      const currentWindowWidth = window.innerWidth / zoom;
      const currentWindowHeight = window.innerHeight / zoom;
      return {
        x: -x / zoom + currentWindowWidth / 2,
        y: -y / zoom + currentWindowHeight / 2,
      };
    }

    const viewport = getStoreViewport() || { x: 0, y: 0, zoom: 0.9 };
    const { x, y, zoom } = viewport;
    const currentWindowWidth = window.innerWidth / zoom;
    const currentWindowHeight = window.innerHeight / zoom;

    const templateBoxes = templateNodes.map(node => ({
      x: node.position.x,
      y: node.position.y,
      width: node.width || DEFAULT_PROMPT_NODE_SIZE.width,
      height: node.height || DEFAULT_PROMPT_NODE_SIZE.height,
    }));
    const boundingBox = computeBoundingBox([], templateBoxes);

    if (!isFinite(boundingBox.minX) || !isFinite(boundingBox.maxX) ||
      !isFinite(boundingBox.minY) || !isFinite(boundingBox.maxY)) {
      return {
        x: -x / zoom + currentWindowWidth / 2,
        y: -y / zoom + currentWindowHeight / 2,
      };
    }

    const templateWidth = boundingBox.maxX - boundingBox.minX;
    const templateHeight = boundingBox.maxY - boundingBox.minY;

    const centerX = -x / zoom + currentWindowWidth / 2 - templateWidth / 2;
    const centerY = -y / zoom + currentWindowHeight / 2 - templateHeight / 2;

    if (!checkOverlap(centerX, centerY, templateWidth, templateHeight)) {
      return { x: centerX, y: centerY };
    }

    // If center is occupied, find nearest free position
    const step = searchStep;
    const maxRadius = Math.max(currentWindowWidth, currentWindowHeight) * 2;

    for (let radius = step; radius < maxRadius; radius += step) {
      const positions = [
        { x: centerX, y: centerY - radius }, // top
        { x: centerX + radius, y: centerY }, // right
        { x: centerX, y: centerY + radius }, // bottom
        { x: centerX - radius, y: centerY }, // left
        { x: centerX + radius * 0.7, y: centerY - radius * 0.7 }, // top-right
        { x: centerX + radius * 0.7, y: centerY + radius * 0.7 }, // bottom-right
        { x: centerX - radius * 0.7, y: centerY + radius * 0.7 }, // bottom-left
        { x: centerX - radius * 0.7, y: centerY - radius * 0.7 }, // top-left
      ];

      for (const pos of positions) {
        if (!checkOverlap(pos.x, pos.y, templateWidth, templateHeight)) {
          return pos;
        }
      }
    }

    const nodes = useFlowStore.getState().nodes;
    if (nodes.length > 0) {
      const rightmostX = Math.max(...nodes.map(node => {
        const nodeWidth = node.width || getNodeSize(node.id).width || DEFAULT_PROMPT_NODE_SIZE.width;
        return node.position.x + nodeWidth;
      }));
      const spacing = positionPadding;
      const firstNodeY = nodes[0].position.y;
      return {
        x: rightmostX + spacing,
        y: firstNodeY,
      };
    }
    return { x: centerX, y: centerY };
  }, [getStoreViewport, checkOverlap, getNodeSize, computeBoundingBox]);

  const handleAddToCanvas = useCallback(
    async (templateId: string) => {
      setLoadingTemplates((prev) => new Set(prev).add(templateId));

      try {
        let template = await loadTemplate(templateId);
        if (!template.flow) {
          throw new Error(`Template "${templateId}" has no flow data`);
        }

        if (!template.flow.nodes || template.flow.nodes.length === 0) {
          throw new Error(`Template has no nodes`);
        }

        let minX = Infinity;
        let minY = Infinity;
        template.flow.nodes.forEach((node) => {
          if (node.position.x < minX) minX = node.position.x;
          if (node.position.y < minY) minY = node.position.y;
        });

        const emptyPlace = findEmptyPlace(template.flow.nodes);
        const offsetX = emptyPlace.x - minX;
        const offsetY = emptyPlace.y - minY;

        const nodeIdMap = new Map<string, string>();
        const addedNodes: string[] = [];

        for (const templateNode of template.flow.nodes) {
          const newPosition = {
            x: templateNode.position.x + offsetX,
            y: templateNode.position.y + offsetY,
          };

          const nodeSize = templateNode.width && templateNode.height
            ? { width: templateNode.width, height: templateNode.height }
            : undefined;

          let newNode;
          if (isPromptNodeData(templateNode.data)) {
            newNode = addPromptNode(newPosition, templateNode.data, nodeSize);
          } else if (isContentNodeData(templateNode.data)) {
            newNode = addContentNode(newPosition, templateNode.data, nodeSize);
          } else if (isContainerNodeData(templateNode.data)) {
            newNode = addContainerNode(newPosition, templateNode.data, nodeSize);
          } else {
            console.warn(`Unknown node type for node ${templateNode.id}, skipping`);
            continue;
          }
          nodeIdMap.set(templateNode.id, newNode.id);
          addedNodes.push(newNode.id);
        }

        for (const templateEdge of template.flow.edges) {
          const newSourceId = nodeIdMap.get(templateEdge.source);
          const newTargetId = nodeIdMap.get(templateEdge.target);

          if (newSourceId && newTargetId) {
            addNewEdge(newSourceId, newTargetId);
          } else {
            console.warn(`Failed to map edge from ${templateEdge.source} to ${templateEdge.target} - node not found in mapping`);
          }
        }

        if (addedNodes.length > 0) {
          requestAnimationFrame(() => {
            const box = computeBoundingBox(addedNodes);
            const padding = viewportPadding;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const boxWidth = Math.max(1, box.maxX - box.minX);
            const boxHeight = Math.max(1, box.maxY - box.minY);
            const availableW = Math.max(50, vw - 2 * padding);
            const availableH = Math.max(50, vh - 2 * padding);

            let targetZoom = Math.min(
              availableW / boxWidth,
              availableH / boxHeight
            );
            targetZoom = Math.max(0.2, Math.min(targetZoom, 2));
            const boxCenterX = (box.minX + box.maxX) / 2;
            const boxCenterY = (box.minY + box.maxY) / 2;
            const targetX = vw / 2 - boxCenterX * targetZoom;
            const targetY = vh / 2 - boxCenterY * targetZoom;

            animateViewport(getViewport, setViewport, targetX, targetY, targetZoom);
          });
        }
        onClose();
      } catch (error) {
        console.error("Failed to add template to canvas:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to add template to canvas";
        enqueueSnackbar(errorMessage, { variant: "error" });
      } finally {
        setLoadingTemplates((prev) => {
          const next = new Set(prev);
          next.delete(templateId);
          return next;
        });
      }
    },
    [findEmptyPlace, addPromptNode, addContentNode, addContainerNode, addNewEdge, computeBoundingBox, getViewport, setViewport, onClose, enqueueSnackbar]
  );

  const handleExport = useCallback(async (templateId: string) => {
    try {
      let template = await loadTemplate(templateId);
      if (!template.flow) {
        throw new Error(`Template "${templateId}" has no flow data`);
      }
      const filename = `${template.name.replace(/\s+/g, "_")}.json`;
      const contentType = "application/json;charset=utf-8;";
      const url =
        "data:" +
        contentType +
        "," +
        encodeURIComponent(JSON.stringify(template.flow, null, 2));
      initiateDownload(filename, url);
    } catch (error) {
      console.error("Failed to export template:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to export template";
      enqueueSnackbar(errorMessage, { variant: "error" });
    }
  },
    [enqueueSnackbar, initiateDownload]
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box
        sx={{
          width: "calc(100% - 80px)",
          maxWidth: "90vw",
          height: "calc(100% - 80px)",
          maxHeight: "90vh",
          backgroundColor: "background.paper",
          borderRadius: "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          padding="20px"
          borderBottom={`1px solid ${theme.palette.divider}`}
        >
          <Typography variant="body1">Templates</Typography>
          <NodeDeleteButton func={onClose} toClose={true} />
        </Stack>

        <Box
          sx={{
            flex: 1,
            overflow: "auto",
            padding: "16px",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(0, 0, 0, 0.2) transparent",
          }}
        >
          {loadingMetadata ? (
            <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }}>
              <CircularProgress size={32} sx={{ color: "text.secondary" }} />
            </Stack>
          ) : templates.length === 0 ? (
            <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }}>
              <Typography variant="body2" color="text.secondary">
                No templates available.
              </Typography>
            </Stack>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "16px",
                position: "relative",
                alignContent: "start",
                alignItems: "start",
              }}
            >
              {templates.map((template) => {
                return (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onAddToCanvas={handleAddToCanvas}
                    onExport={handleExport}
                    expandedCardId={expandedCardId}
                    onToggleExpand={setExpandedCardId}
                    loadingTemplates={loadingTemplates}
                  />
                );
              })}
            </Box>
          )}
        </Box>
      </Box>
    </Modal>
  );
};

export default memo(TemplatesModal);

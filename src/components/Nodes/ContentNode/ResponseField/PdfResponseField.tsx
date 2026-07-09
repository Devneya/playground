import { useState, useEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Box, CircularProgress } from "@mui/material";
import { ArrowBack, ArrowForward } from "@mui/icons-material";
import NodeButton from "../../../Buttons/NodeButton";
import { downloadFile } from "../../../../storage";
import theme from "../../../../themes";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfResponseFieldProps {
  path: string;
}

const PdfStatus = ({ text }: { text: string }) => (
  <Box
    sx={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "background.default",
      color: "text.secondary",
      fontSize: 14,
      userSelect: "none",
    }}
  >
    {text}
  </Box>
);


export async function pdfToBase64PageChunks(pdfBlob: Blob, scale = 1.5, pagesPerChunk = 4): Promise<string[][]> {
  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const chunks: string[][] = [];
  let currentChunk: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const base64 = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
    currentChunk.push(base64);

    if (currentChunk.length === pagesPerChunk || i === pdf.numPages) {
      chunks.push(currentChunk);
      currentChunk = [];
    }
  }
  return chunks;
}

export function PdfResponseField({ path }: PdfResponseFieldProps) {

  const containerRef = useRef<HTMLDivElement>(null);

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    setLoading(true);
    setBlobUrl(null);
    setError(null);

    const loadPdf = async () => {
      try {
        const resp = await downloadFile(path);
        if (cancelled) {
          return;
        }
        if (resp instanceof Error) {
          throw resp;
        }

        objectUrl = URL.createObjectURL(resp);
        setBlobUrl(objectUrl);
      } catch (err) {
        console.error("PDF download failed:", err);
        setError(`${err}`);
      } finally {
        setLoading(false);
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path]);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  }, []);

  const onPageLoadSuccess = useCallback((page: any) => {
    const { originalWidth, originalHeight } = page;
    setPageSize({ width: originalWidth, height: originalHeight });
  }, []);

  const goToPrevPage = useCallback(() => setPageNumber(prev => Math.max(prev - 1, 1)), []);
  const goToNextPage = useCallback(() => setPageNumber(prev => Math.min(prev + 1, numPages)), [numPages]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const updateScale = () => {
      if (containerRef.current && pageSize) {
        const { clientWidth, clientHeight } = containerRef.current;
        const scaleWidth = clientWidth / pageSize.width;
        const scaleHeight = clientHeight / pageSize.height;
        setScale(Math.min(scaleWidth, scaleHeight));
      }
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [pageSize]);

  return (
    <Box
      ref={containerRef}
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
      }}
    >
      <Box
        sx={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          boxSizing: "border-box",
          backgroundColor: "background.default",
          border: `2px solid ${theme.palette.text.disabled}`,
        }}
      >
        {loading &&
          <Box
            sx={{
              height: "100%",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "transparent",
              boxSizing: "border-box",
              color: theme.palette.text.disabled,
            }}
          >
            <CircularProgress size={32} color={"inherit"} />
          </Box>
        }

        {error && !loading && <PdfStatus text={error} />}

        {!loading && !error && blobUrl && (
          <Document
            file={blobUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => {
              console.error("PDF load error", err);
              setLoading(false);
            }}
            loading={<PdfStatus text="Loading document..." />}
            error={<PdfStatus text="Failed to load document" />}
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              onLoadSuccess={onPageLoadSuccess}
              loading={<PdfStatus text="Loading page..." />}
              error={<PdfStatus text="Failed to load page" />}
            />
          </Document>
        )}
      </Box>

      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 2,
          boxSizing: "border-box",
          height: "36px",
        }}
        padding="4px 0px 4px 0px"
      >
        {numPages > 1 && (
          <>
            <NodeButton
              func={goToPrevPage}
              icon={ArrowBack}
              toolTipValue="Previous page"
              disabled={pageNumber <= 1}
            />
            <Box>{pageNumber} / {numPages}</Box>
            <NodeButton
              func={goToNextPage}
              icon={ArrowForward}
              toolTipValue="Next page"
              disabled={pageNumber >= numPages}
            />
          </>
        )}
      </Box>
    </Box>
  );
}
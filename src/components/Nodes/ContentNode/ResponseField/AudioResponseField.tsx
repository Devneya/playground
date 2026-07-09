import { Box, CircularProgress, Typography } from "@mui/material";
import React, { useEffect, useState } from "react";
import { downloadFile } from "../../../../storage";
import { AudioResponse } from "../../../../logic/flowStore/interfaces";

interface AudioResponseFieldProps {
  audio: AudioResponse;
}

export default function AudioResponseField({ audio }: AudioResponseFieldProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;

    const loadAudio = async () => {
      if (!audio.path) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);

        const resp = await downloadFile(audio.path);
        if (resp instanceof Error) {
          throw resp;
        }
        objectUrl = URL.createObjectURL(resp);
        if (isMounted) {
          setUrl(objectUrl);
        }
      } catch (e) {
        console.error("Audio load error:", e);
        if (isMounted) {
          setError("Failed to load audio");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadAudio();
    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [audio.path]);

  if (loading) {
    return (
      <Box
        sx={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error || !url) {
    return (
      <Typography variant="body2">
        {error ?? "Audio unavailable"}
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
      padding="0px 4px 0px 4px"
    >
      <audio
        controls
        preload="metadata"
        src={url}
        style={{ width: "100%" }}
      />
    </Box>
  );
}

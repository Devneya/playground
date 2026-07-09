import React, {useEffect, useState, useRef, memo} from 'react';
import {Stack, Typography} from '@mui/material';

interface ProcessingAnimationProps {
  message?: string;
}

export const ProcessingAnimation: React.FC<ProcessingAnimationProps> = memo(({message = 'processing'}) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    startTimeRef.current = Date.now();

    const updateTimer = () => {
      const now = Date.now();
      const elapsed = now - startTimeRef.current;
      setElapsedTime(elapsed);
      animationFrameRef.current = requestAnimationFrame(updateTimer);
    };

    animationFrameRef.current = requestAnimationFrame(updateTimer);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const formatTime = (ms: number): string => {
    return (ms / 1000).toFixed(1) + 's';
  };

  return (
    <Stack
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      padding="12px 8px"
    >
      <Typography variant="body2" align="center">
        {message} | {formatTime(elapsedTime)}
      </Typography>
    </Stack>
  );
});
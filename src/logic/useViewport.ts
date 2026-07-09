/* 
  Work with viewport may seem strange and complicated, and it is. 
  ReactFlow library only allows to specify 'defaultViewport', which sometimes is not equal to actual visualisated. 
  So we can not simply store our viewport value in store and give it to ReactFlow component, 
  we actually have to tell inner ReactFlow storage to change it, if we want to, with setViewport funtion of useReactFlow hoo.
*/
import {Viewport, useReactFlow} from '@xyflow/react';
import useFlowStore from "./flowStore/flowStore";

export default function useViewport() {
  const {getViewport, setViewport: setViewportFlow} = useReactFlow();
  const setStoreViewport = useFlowStore.use.setStoreViewport();
  return {
    getViewport,
    setViewport: (newViewport: Viewport) => {
      setViewportFlow(newViewport);
      setStoreViewport(newViewport);
    },
  };
}

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function animateViewport(
  getViewport: () => Viewport,
  setViewport: (v: Viewport) => void,
  targetX: number,
  targetY: number,
  targetZoom?: number,
  duration: number = 1800
) {
  // cancel previous if any
  if ((animateViewport as any)._rafId) {
    cancelAnimationFrame((animateViewport as any)._rafId);
    (animateViewport as any)._rafId = null;
  }

  const start = performance.now();
  const from = getViewport();

  const distance = Math.hypot(targetX - from.x, targetY - from.y);
  const dynamicDuration = Math.min(3000, Math.max(500, distance * 0.8));
  const animDuration = duration ?? dynamicDuration;

  if (animDuration <= 0) {
    setViewport({x: targetX, y: targetY, zoom: targetZoom ?? from.zoom});
    return;
  }

  function step(now: number) {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / animDuration);
    const k = easeInOutCubic(t);

    const next: Viewport = {
      x: from.x + (targetX - from.x) * k,
      y: from.y + (targetY - from.y) * k,
      zoom: from.zoom + ((targetZoom ?? from.zoom) - from.zoom) * k,
    };
    setViewport(next);
    if (t < 1) {
      (animateViewport as any)._rafId = requestAnimationFrame(step);
    } else {
      (animateViewport as any)._rafId = null;
    }
  }

  (animateViewport as any)._rafId = requestAnimationFrame(step);
}
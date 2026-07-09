import {intersections, Point, Rectangle, Segment} from "@mathigon/euclid";
import {Node, Position, XYPosition} from "@xyflow/react";

const EPS = 1e-8;

function getPosition(component: Node | XYPosition) {
  return "x" in component
    ? component
    : component.position;
}

function getCenter(component: Node | XYPosition) {
  if ("x" in component) return component;
  const leftUpCorner = component.position;
  return {
    x: leftUpCorner.x + ((component.style?.width ?? 0) as number) / 2,
    y: leftUpCorner.y + ((component.style?.height ?? 0) as number) / 2,
  };
}

function toPoint(position: XYPosition) {
  return new Point(position.x, position.y);
}

// Linear interpolation: smooth transition between numbers
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mixPoints(p1: XYPosition, p2: XYPosition, t: number): XYPosition {
  return {
    x: lerp(p1.x, p2.x, t),
    y: lerp(p1.y, p2.y, t)
  };
}

// Base intersection:
// this helper function returns the intersection point
// of the line between the center of the intersectionNode and the target node
function getBaseIntersection(nodeFrom: Node, target: Node | XYPosition): XYPosition {
  // https://math.stackexchange.com/questions/1724792/an-algorithm-for-finding-the-intersection-point-between-a-center-of-vision-and-a
  const sourceCenter = toPoint(getCenter(nodeFrom));
  const targetCenter = toPoint(getCenter(target));
  const nodeRectangle = new Rectangle(
    toPoint(getPosition(nodeFrom)),
    (nodeFrom.width ?? 0) as number,
    (nodeFrom.height ?? 0) as number
  );
  const intersection = intersections(
    new Segment(sourceCenter, targetCenter),
    nodeRectangle
  );
  if (intersection.length < 1) return targetCenter;
  return {
    x: intersection[0].x,
    y: intersection[0].y,
  };
}

// Projection intersection:
// returns the intersection point of the horizontal or vertical line
function getProjectionIntersection(nodeFrom: Node, target: Node, isVertical: boolean): Point[] {
  const sourceCenter = toPoint(getCenter(nodeFrom));
  const targetCenter = toPoint(getCenter(target));
  const nodeRectangle = new Rectangle(
    toPoint(getPosition(nodeFrom)),
    (nodeFrom.width ?? 0) as number,
    (nodeFrom.height ?? 0) as number
  );

  const segment = isVertical
    ? new Segment(sourceCenter, new Point(sourceCenter.x, targetCenter.y))
    : new Segment(sourceCenter, new Point(targetCenter.x, sourceCenter.y));

  return intersections(segment, nodeRectangle);
}

// intersection: mix between base and projection intersections with easing
export function getNodeIntersection(nodeFrom: Node, target: Node, isVertical: boolean): XYPosition {
  const sourceCenter = getCenter(nodeFrom);
  const targetCenter = getCenter(target);

  const dx = Math.abs(targetCenter.x - sourceCenter.x);
  const dy = Math.abs(targetCenter.y - sourceCenter.y);
  const tx = Math.min(1, dx / ((nodeFrom.width ?? 0) / 2));
  const ty = Math.min(1, dy / ((nodeFrom.height ?? 0) / 2));
  const t = Math.min(tx, ty);
  const easedT = t * t * (3 - 2 * t); // easing for smooth transitions

  const baseIntersection = getBaseIntersection(nodeFrom, target);
  const projectionIntersectionArray = getProjectionIntersection(nodeFrom, target, isVertical);
  const projectionIntersection = projectionIntersectionArray.length ?
    {
      x: projectionIntersectionArray[0].x,
      y: projectionIntersectionArray[0].y
    }
    : baseIntersection;

  // Blend base + triangle-based
  return mixPoints(baseIntersection, projectionIntersection, easedT);
}

// returns the position (top,right,bottom or right) passed node compared to the intersection point
function getEdgePosition(
  component: Node | XYPosition,
  intersectionPoint: XYPosition
): Position {
  const pos = getPosition(component);
  const width =
    "style" in component ? ((component.style?.width ?? 0) as number) : 0;
  return intersectionPoint.x <= pos.x + EPS
    ? Position.Left
    : intersectionPoint.x >= pos.x + width - EPS
      ? Position.Right
      : intersectionPoint.y <= pos.y + EPS
        ? Position.Top
        : Position.Bottom;
}

// returns the parameters (sx, sy, tx, ty, sourcePos, targetPos) you need to create an edge
export function getEdgeParams(source: Node, target: Node | XYPosition) {
  const isPoint = "x" in target;

  const sourceIntersectionPoint = isPoint
    ? getBaseIntersection(source, target)
    : getNodeIntersection(source, target, false);

  const targetIntersectionPoint = isPoint
    ? target
    : getNodeIntersection(target, source, true);

  const sourcePos = getEdgePosition(source, sourceIntersectionPoint);
  const targetPos = isPoint
    ? getEdgePosition(target, sourceIntersectionPoint)
    : getEdgePosition(target, targetIntersectionPoint);

  return {
    sx: sourceIntersectionPoint.x,
    sy: sourceIntersectionPoint.y,
    tx: targetIntersectionPoint.x,
    ty: targetIntersectionPoint.y,
    sourcePos,
    targetPos,
  };
}

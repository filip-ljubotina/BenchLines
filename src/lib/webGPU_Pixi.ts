import { getLineNameCanvas } from "./brush";
import { canvasEl, lineState } from "./globals";
import { clearDataPointLabels, createLabelsContainer, showDataPointLabels } from "./labelUtils";
import * as PIXI from "pixi.js"; // Use the main pixi.js package for v8+ with WebGPU support

let renderer: PIXI.WebGPURenderer | null = null;
let stage: PIXI.Container | null = null;
let linesContainer: PIXI.Container | null = null;

const lineGraphics: Map<string, PIXI.Graphics> = new Map();

let hoveredLineId: string | null = null;
let isMouseOverCanvas = false;
let currentParcoords: any = null;
let currentDataset: any[] = [];
const HOVER_THRESHOLD = 5;

function disposeWebGPUPixi() {
  const plotArea = document.getElementById("plotArea") as HTMLDivElement;
  plotArea.removeEventListener("mousemove", onMouseMove);
  plotArea.removeEventListener("mouseenter", onMouseEnter);
  plotArea.removeEventListener("mouseleave", onMouseLeave);

  clearDataPointLabels();

  lineGraphics.clear();

  if (stage) {
    stage.destroy({ children: true });
    stage = null;
  }

  linesContainer = null;

  if (renderer) {
    renderer.destroy();
    renderer = null;
  }

  hoveredLineId = null;
  isMouseOverCanvas = false;
  currentParcoords = null;
  currentDataset = [];
}

function getPolylinePoints(d: any, parcoords: any): [number, number][] {
  const pts: [number, number][] = [];
  parcoords.newFeatures.forEach((name: string) => {
    const x =
      parcoords.dragging[name] !== undefined
        ? parcoords.dragging[name]
        : parcoords.xScales(name);
    const y = parcoords.yScales[name](d[name]);
    pts.push([x, y]);
  });
  return pts;
}

function pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

export async function initCanvasWebGPUPixi() {
  disposeWebGPUPixi();

  const width = canvasEl.clientWidth;
  const height = canvasEl.clientHeight;
  const dpr = window.devicePixelRatio || 1;

  renderer = new PIXI.WebGPURenderer();
  await renderer.init({
    canvas: canvasEl,
    width,
    height,
    resolution: dpr,
    antialias: true,
    autoDensity: true,
    background: 0x000000,
    backgroundAlpha: 0,
    clearBeforeRender: true,
  });

  stage = new PIXI.Container();
  linesContainer = new PIXI.Container();
  stage.addChild(linesContainer);

  createLabelsContainer();

  const plotArea = document.getElementById("plotArea") as HTMLDivElement;
  plotArea.addEventListener("mousemove", onMouseMove);
  plotArea.addEventListener("mouseenter", onMouseEnter);
  plotArea.addEventListener("mouseleave", onMouseLeave);

  return renderer;
}

export function redrawWebGPUPixiLines(dataset: any[], parcoords: any) {
  if (!renderer || !stage || !linesContainer || !dataset) return;

  currentParcoords = parcoords;
  currentDataset = dataset;

  const usedIds = new Set<string>();

  dataset.forEach((d) => {
    const id = getLineNameCanvas(d);
    usedIds.add(id);

    const active = lineState[id]?.active ?? true;
    const pts = getPolylinePoints(d, parcoords);
    if (!pts.length) return;

    let graphics = lineGraphics.get(id);

    if (!graphics) {
      graphics = new PIXI.Graphics();
      lineGraphics.set(id, graphics);
      linesContainer.addChild(graphics);
    }

    const color = active ? 0x0081af : 0xd3d3d3;
    const alpha = active ? 0.5 : 0.4;
    const lineWidth = 2;

    graphics.clear();
    graphics.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      graphics.lineTo(pts[i][0], pts[i][1]);
    }
    graphics.stroke({ width: lineWidth, color, alpha });
  });

  for (const [id, graphics] of lineGraphics) {
    if (!usedIds.has(id)) {
      graphics.destroy();
      lineGraphics.delete(id);
    }
  }

  // Reapply hover if any
  if (hoveredLineId) {
    const graphics = lineGraphics.get(hoveredLineId);
    if (graphics) {
      const data = dataset.find(d => getLineNameCanvas(d) === hoveredLineId);
      if (data) {
        const pts = getPolylinePoints(data, parcoords);
        graphics.clear();
        graphics.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          graphics.lineTo(pts[i][0], pts[i][1]);
        }
        graphics.stroke({ width: 4, color: 0xff3333, alpha: 1 });
      }
    }
  }

  renderer.render(stage);
}

function onMouseMove(event: MouseEvent) {
  if (!isMouseOverCanvas) return;

  const rect = canvasEl.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  checkHover(mouseX, mouseY);
}

function onMouseEnter() {
  isMouseOverCanvas = true;
}

function onMouseLeave() {
  isMouseOverCanvas = false;
  clearHover();
  clearDataPointLabels();
  if (renderer && stage) renderer.render(stage);
}

function checkHover(mouseX: number, mouseY: number) {
  let closestId: string | null = null;
  let minDist = HOVER_THRESHOLD;

  for (const d of currentDataset) {
    const id = getLineNameCanvas(d);
    const pts = getPolylinePoints(d, currentParcoords);
    if (!pts.length) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const dist = pointToLineDistance(mouseX, mouseY, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (dist < minDist) {
        minDist = dist;
        closestId = id;
      }
    }
  }

  if (closestId !== hoveredLineId) {
    clearHover();
    hoveredLineId = closestId;
    if (hoveredLineId) {
      const data = currentDataset.find(d => getLineNameCanvas(d) === hoveredLineId);
      if (data) {
        onLineHover(true);
        showDataPointLabels(currentParcoords, data);
        const graphics = lineGraphics.get(hoveredLineId);
        if (graphics) {
          const pts = getPolylinePoints(data, currentParcoords);
          graphics.clear();
          graphics.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) {
            graphics.lineTo(pts[i][0], pts[i][1]);
          }
          graphics.stroke({ width: 4, color: 0xff3333, alpha: 1 });
        }
      }
    }
  }

  if (renderer && stage) renderer.render(stage);
}

function clearHover() {
  if (hoveredLineId) {
    const graphics = lineGraphics.get(hoveredLineId);
    if (graphics) {
      const data = currentDataset.find(d => getLineNameCanvas(d) === hoveredLineId);
      if (data) {
        const active = lineState[hoveredLineId]?.active ?? true;
        const pts = getPolylinePoints(data, currentParcoords);
        graphics.clear();
        graphics.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          graphics.lineTo(pts[i][0], pts[i][1]);
        }
        const color = active ? 0x0081af : 0xd3d3d3;
        const alpha = active ? 0.5 : 0.4;
        graphics.stroke({ width: 2, color, alpha });
      }
    }
    hoveredLineId = null;
    onLineHover(false);
  }
}

function onLineHover(isHovered: boolean) {
  if (isHovered) {
    canvasEl.style.cursor = "pointer";
  } else {
    canvasEl.style.cursor = "default";
  }
}
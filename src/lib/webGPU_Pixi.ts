import { getLineNameCanvas } from "./brush";
import { canvasEl, lineState, parcoords } from "./globals";
import { clearDataPointLabels, createLabelsContainer, showDataPointLabels } from "./labelUtils";
import * as PIXI from "pixi.js"; // Use the main pixi.js package for v8+ with WebGPU support

let renderer: PIXI.WebGPURenderer | null = null;
let stage: PIXI.Container | null = null;
let linesContainer: PIXI.Container | null = null;

let backgroundGraphics: PIXI.Graphics | null = null;
let hoverGraphics: PIXI.Graphics | null = null;

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

  if (backgroundGraphics) {
    backgroundGraphics.destroy();
    backgroundGraphics = null;
  }
  if (hoverGraphics) {
    hoverGraphics.destroy();
    hoverGraphics = null;
  }

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

  backgroundGraphics = new PIXI.Graphics();
  linesContainer.addChild(backgroundGraphics);

  hoverGraphics = new PIXI.Graphics();
  linesContainer.addChild(hoverGraphics);

  createLabelsContainer();

  currentParcoords = parcoords;
  currentDataset = parcoords.newDataset;

  const plotArea = document.getElementById("plotArea") as HTMLDivElement;
  plotArea.addEventListener("mousemove", onMouseMove);
  plotArea.addEventListener("mouseenter", onMouseEnter);
  plotArea.addEventListener("mouseleave", onMouseLeave);

  return renderer;
}

export function redrawWebGPUPixiLines(dataset: any[], parcoords: any) {
  if (!renderer || !stage || !linesContainer || !backgroundGraphics || !dataset) return;

  currentParcoords = parcoords;
  currentDataset = dataset;

  backgroundGraphics.clear();

  dataset.forEach((d) => {
    const active = lineState[getLineNameCanvas(d)]?.active ?? true;
    const pts = getPolylinePoints(d, parcoords);
    if (!pts.length) return;

    const color = active ? 0x0081af : 0xd3d3d3;
    const alpha = active ? 0.5 : 0.4;
    const lineWidth = 2;

    backgroundGraphics.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      backgroundGraphics.lineTo(pts[i][0], pts[i][1]);
    }
    backgroundGraphics.stroke({ width: lineWidth, color, alpha });
  });

  // Reapply hover if any
  if (hoveredLineId) {
    const data = dataset.find(d => getLineNameCanvas(d) === hoveredLineId);
    if (data) {
      const pts = getPolylinePoints(data, parcoords);
      hoverGraphics.clear();
      hoverGraphics.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        hoverGraphics.lineTo(pts[i][0], pts[i][1]);
      }
      hoverGraphics.stroke({ width: 4, color: 0xff3333, alpha: 1 });
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
        if (hoverGraphics) {
          const pts = getPolylinePoints(data, currentParcoords);
          hoverGraphics.clear();
          hoverGraphics.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) {
            hoverGraphics.lineTo(pts[i][0], pts[i][1]);
          }
          hoverGraphics.stroke({ width: 4, color: 0xff3333, alpha: 1 });
        }
      }
    }
  }

  if (renderer && stage) renderer.render(stage);
}

function clearHover() {
  if (hoveredLineId) {
    if (hoverGraphics) {
      hoverGraphics.clear();
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
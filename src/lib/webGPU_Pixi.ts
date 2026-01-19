import * as PIXI from "pixi.js";
import { getLineNameCanvas } from "./brush";
import { canvasEl, drawState, lineState, parcoords } from "./globals";
import { initHoverDetection, SelectionMode } from "./hover/hover";
import { initLineTextureWebGL, drawInactiveLinesTexture, rasterizeInactiveLinesToCanvas } from "./lineTexture";
import {
  clearDataPointLabels,
  createLabelsContainer,
  showDataPointLabels,
} from "./labelUtils";

let renderer: PIXI.WebGPURenderer | null = null;
let stage: PIXI.Container | null = null;
let linesContainer: PIXI.Container | null = null;
let lineGraphics: Map<string, PIXI.Graphics> = new Map();
let lineDataMap: Map<PIXI.Graphics, any> = new Map();
let ptsMap: Map<string, [number, number][]> = new Map();
let hoveredLineIds: Set<string> = new Set();
let selectedLineIds: Set<string> = new Set();
let dataset: any[] = [];
let isInitialized = false;
let currentParcoords: any = null;

// Background canvas
let inactiveLinesCanvas: HTMLCanvasElement;
let bgGlCanvas: HTMLCanvasElement | null = null;

interface LineStyle {
  color: number;
  width: number;
  alpha: number;
  zIndex: number;
}

const activeStyle: LineStyle = {
  color: 0x80bfd6,
  width: 2,
  alpha: 1,
  zIndex: 0,
};
const inactiveStyle: LineStyle = {
  color: 0xebebeb,
  width: 1,
  alpha: 1,
  zIndex: 0,
};
const hoverStyle: LineStyle = {
  color: 0xff3333,
  width: 3,
  alpha: 1,
  zIndex: 1,
};
const selectedStyle: LineStyle = {
  color: 0xff8000, // orange
  width: 3,
  alpha: 1,
  zIndex: 2,
};

export function disposeWebGPUPixi() {
  const plotArea = document.getElementById("plotArea") as HTMLDivElement;
  plotArea.removeEventListener("click", onCanvasClick);
  clearDataPointLabels();
  if (linesContainer) {
    linesContainer.removeChildren();
  }
  for (const [_, graphics] of lineGraphics) {
    graphics.destroy();
  }
  lineGraphics.clear();
  lineDataMap.clear();
  ptsMap.clear();
  if (stage) {
    stage.destroy(true);
    stage = null;
  }
  if (renderer) {
    renderer.destroy();
    renderer = null;
  }
  linesContainer = null;
  hoveredLineIds.clear();
  selectedLineIds.clear();
  dataset = [];
  currentParcoords = null;
  isInitialized = false;
}

export async function initCanvasWebGPUPixi(dataset: any[], parcoords: any) {
  disposeWebGPUPixi();
  const width = canvasEl.clientWidth;
  const height = canvasEl.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  try {
    renderer = new PIXI.WebGPURenderer();
    await renderer.init({
      canvas: canvasEl,
      width,
      height,
      resolution: dpr,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      clearBeforeRender: true,
    });
  } catch (error) {
    console.error("Failed to initialize WebGPU renderer:", error);
    throw error;
  }
  stage = new PIXI.Container();
  linesContainer = new PIXI.Container();
  linesContainer.sortableChildren = true;
  stage.addChild(linesContainer);

  //create background lines image
  inactiveLinesCanvas = document.createElement("canvas");
  inactiveLinesCanvas.width = canvasEl.width;
  inactiveLinesCanvas.height = canvasEl.height;
  inactiveLinesCanvas.style.position = "absolute";
  inactiveLinesCanvas.style.top = canvasEl.style.top;
  inactiveLinesCanvas.style.left = canvasEl.style.left;
  inactiveLinesCanvas.style.pointerEvents = "none";
  inactiveLinesCanvas.style.width = canvasEl.style.width;
  inactiveLinesCanvas.style.height = canvasEl.style.height;

  // Insert behind the main canvas
  canvasEl.parentNode?.insertBefore(inactiveLinesCanvas, canvasEl);

  // initLineTextureWebGL(bgGlCanvas);
  // drawInactiveLinesTexture(dataset, parcoords);
  redrawWebGPUPixiBackgroundLines(dataset, parcoords);

  createLabelsContainer();
  await initHoverDetection(parcoords, onHoveredLinesChange);
  setupCanvasClickHandling();
  isInitialized = true;
  return renderer;
}

export function redrawWebGPUPixiBackgroundLines(dataset: any[], parcoords: any) {
  if (!inactiveLinesCanvas) {
    console.warn("Inactive background canvas not initialized");
    return;
  }

  const w = inactiveLinesCanvas.width;
  const h = inactiveLinesCanvas.height;

  // Create the offscreen WebGL canvas once
  if (!bgGlCanvas) {
    bgGlCanvas = document.createElement("canvas");
    bgGlCanvas.width = w;
    bgGlCanvas.height = h;
  }

  // Initialize WebGL and draw the inactive lines
  initLineTextureWebGL(bgGlCanvas);
  drawInactiveLinesTexture(dataset, parcoords);

  // Rasterize result into the 2D background canvas
  rasterizeInactiveLinesToCanvas(inactiveLinesCanvas);
}

function getLineStyle(id: string): LineStyle {
  const isHovered = hoveredLineIds.has(id);
  const isSelected = selectedLineIds.has(id);
  const active = lineState[id]?.active ?? true;
  if (isSelected) {
    return selectedStyle;
  } else if (isHovered) {
    return hoverStyle;
  } else {
    return active ? activeStyle : inactiveStyle;
  }
}

function drawLine(
  graphics: PIXI.Graphics,
  pts: [number, number][],
  style: LineStyle
) {
  graphics.clear();
  if (pts.length > 0) {
    graphics.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      graphics.lineTo(pts[i][0], pts[i][1]);
    }
    graphics.stroke({
      width: style.width,
      color: style.color,
      alpha: style.alpha,
    });
  }
  graphics.zIndex = style.zIndex;
}

function updateLineStyles() {
  for (const [id, graphics] of lineGraphics) {
    const pts = ptsMap.get(id);
    if (pts) {
      const style = getLineStyle(id);
      drawLine(graphics, pts, style);
    }
  }
  if (linesContainer) {
    linesContainer.sortChildren();
  }
}

function onHoveredLinesChange(
  hoveredIds: string[],
  selectionMode: SelectionMode
) {
  if (selectionMode === "hover") {
    hoveredLineIds.clear();
    // Only add active lines to hovered set
    hoveredIds.forEach((id) => {
      const isActive = lineState[id]?.active ?? true;
      if (isActive) {
        hoveredLineIds.add(id);
      }
    });
    if (hoveredLineIds.size > 0) {
      const firstHoveredId = Array.from(hoveredLineIds)[0];
      const data = dataset.find((d) => getLineNameCanvas(d) === firstHoveredId);
      if (data) {
        showDataPointLabels(currentParcoords, data);
      }
    } else {
      clearDataPointLabels();
    }
  } else {
    selectedLineIds.clear();
    // Only add active lines to selection
    hoveredIds.forEach((id) => {
      const isActive = lineState[id]?.active ?? true;
      if (isActive) {
        selectedLineIds.add(id);
      }
    });
  }
  updateLineStyles();
  if (renderer && stage) {
    renderer.render(stage);
  }
}

function onCanvasClick(event: MouseEvent) {
  if (event.shiftKey) {
    if (hoveredLineIds.size > 0) {
      // Only add active lines to selection
      hoveredLineIds.forEach((id) => {
        const isActive = lineState[id]?.active ?? true;
        if (isActive) {
          selectedLineIds.add(id);
        }
      });
    }
  } else if (drawState.wasDrawing === false) {
    // Regular click: clear selected
    selectedLineIds.clear();
  } else {
    drawState.wasDrawing = false;
  }
  updateLineStyles();
  if (renderer && stage) {
    renderer.render(stage);
  }
}

function setupCanvasClickHandling() {
  const plotArea = document.getElementById("plotArea") as HTMLDivElement;
  plotArea.addEventListener("click", onCanvasClick);
}

function getPolylinePoints(d: any, parcoords: any): [number, number][] {
  const pts: [number, number][] = [];
  parcoords.newFeatures.forEach((name: string) => {
    const x = parcoords.dragging[name] ?? parcoords.xScales(name);
    const y = parcoords.yScales[name](d[name]);
    pts.push([x, y]);
  });
  return pts;
}

export function redrawWebGPUPixiLines(newDataset: any[], parcoords: any) {
  if (!renderer || !stage || !linesContainer || !isInitialized) {
    console.warn("WebGPU-Pixi not initialized, skipping redraw");
    return;
  }
  dataset = newDataset;
  currentParcoords = parcoords;
  const usedIds = new Set<string>();
  dataset.forEach((d, index) => {
    const id = getLineNameCanvas(d);
    const active = lineState[id]?.active ?? true;
    if (!active) {
      return;
    }
    usedIds.add(id);
    const pts = getPolylinePoints(d, parcoords);
    let graphics = lineGraphics.get(id);
    if (!graphics) {
      graphics = new PIXI.Graphics();
      linesContainer.addChild(graphics);
      lineGraphics.set(id, graphics);
      lineDataMap.set(graphics, d);
    } else {
      lineDataMap.set(graphics, d);
    }
    ptsMap.set(id, pts);
  });
  for (const [id, graphics] of lineGraphics) {
    if (!usedIds.has(id)) {
      linesContainer.removeChild(graphics);
      graphics.destroy();
      lineDataMap.delete(graphics);
      lineGraphics.delete(id);
      ptsMap.delete(id);
    }
  }
  updateLineStyles();
  if (linesContainer) {
    linesContainer.sortChildren();
  }
  renderer.render(stage);
}

export function getSelectedIds(): Set<string> {
  return selectedLineIds;
}

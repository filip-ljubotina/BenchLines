import { getLineNameCanvas } from "./brush";
import { canvasEl, lineState, drawState } from "./globals";
import * as PIXI from "pixi.js-legacy";
import { initHoverDetection, SelectionMode } from "./hover/hover";
import { initLineTextureWebGL, drawInactiveLinesTexture, rasterizeInactiveLinesToCanvas } from "./lineTexture";
import {
  clearDataPointLabels,
  createLabelsContainer,
  showDataPointLabels,
} from "./labelUtils";

let renderer: PIXI.Renderer | null = null;  // WebGL renderer
let stage: PIXI.Container | null = null;
let linesContainer: PIXI.Container | null = null;

const lineGraphics: Map<string, PIXI.Graphics> = new Map();
let lineDataMap: Map<PIXI.Graphics, any> = new Map();
let ptsMap: Map<string, [number, number][]> = new Map();
let hoveredLineIds: Set<string> = new Set();
let selectedLineIds: Set<string> = new Set();
let dataset: any[] = [];
let currentParcoords: any = null;

// Background canvas
let inactiveLinesCanvas: HTMLCanvasElement;
let bgGlCanvas: HTMLCanvasElement | null = null;

interface LineStyle {
  color: number;
  width: number;
  alpha: number;
}

const activeStyle: LineStyle = {
  color: 0x0081af,
  width: 2,
  alpha: 0.5,
};
const inactiveStyle: LineStyle = {
  color: 0xd3d3d3,
  width: 1,
  alpha: 0.4,
};
const hoverStyle: LineStyle = {
  color: 0xff3333,
  width: 3,
  alpha: 1,
};
const selectedStyle: LineStyle = {
  color: 0xff8000, // orange
  width: 3,
  alpha: 1,
};

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
  graphics.lineStyle(style.width, style.color, style.alpha);
  if (pts.length > 0) {
    graphics.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      graphics.lineTo(pts[i][0], pts[i][1]);
    }
  }
}

function updateLineStyles() {
  for (const [id, graphics] of lineGraphics) {
    const pts = ptsMap.get(id);
    if (pts) {
      const style = getLineStyle(id);
      drawLine(graphics, pts, style);
    }
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

export function redrawWebGLLinesPixiJS(dataset_: any[], parcoords: any) {
  if (!renderer || !stage || !linesContainer || !dataset_) return;

  dataset = dataset_;
  currentParcoords = parcoords;

  const usedIds = new Set<string>();

  for (const d of dataset) {
    const id = getLineNameCanvas(d);
    const active = lineState[id]?.active ?? true;
    if (!active) {
      continue;
    }
    usedIds.add(id);
    const pts = getPolylinePoints(d, parcoords);
    ptsMap.set(id, pts);

    let graphics = lineGraphics.get(id);
    if (!graphics) {
      graphics = new PIXI.Graphics();
      linesContainer.addChild(graphics);
      lineGraphics.set(id, graphics);
      lineDataMap.set(graphics, d);
    } else {
      lineDataMap.set(graphics, d);
    }
  }

  // Remove graphics for lines no longer in dataset
  for (const [id, graphics] of lineGraphics) {
    if (!usedIds.has(id)) {
      linesContainer.removeChild(graphics);
      lineDataMap.delete(graphics);
      lineGraphics.delete(id);
      ptsMap.delete(id);
    }
  }

  updateLineStyles();
  renderer.render(stage);
}

export async function initCanvasWebGLPixiJS(dataset: any[], parcoords: any) {
  return Promise.resolve().then(async () => {
    const dpr = window.devicePixelRatio || 1;
    renderer = new PIXI.Renderer({
      view: canvasEl,
      width: canvasEl.width / dpr,
      height: canvasEl.height / dpr,
      resolution: dpr,
      backgroundAlpha: 0,
      autoDensity: true,
      clearBeforeRender: true,
    });

    stage = new PIXI.Container();
    linesContainer = new PIXI.Container();
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
    redrawWebGLPixiBackgroundLines(dataset, parcoords);

    createLabelsContainer();
    
    return renderer;
  });
}

export function redrawWebGLPixiBackgroundLines(dataset: any[], parcoords: any) {
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

export function destroyPixiRenderer() {
  const plotArea = document.getElementById("plotArea") as HTMLDivElement;
  if (plotArea) {
    plotArea.removeEventListener("click", onCanvasClick);
  }
  clearDataPointLabels();
  if (renderer) {
    renderer.destroy(true); // destroy WebGL resources
    renderer = null;
  }
  if (stage) {
    stage.destroy({ children: true });
    stage = null;
  }
  linesContainer = null;
  lineGraphics.clear();
  lineDataMap.clear();
  ptsMap.clear();
  hoveredLineIds.clear();
  selectedLineIds.clear();
  dataset = [];
  currentParcoords = null;
}

export function getSelectedIds(): Set<string> {
  return selectedLineIds;
}

export function initHoverDetectionPixiJS(parcoords: any) {
  return initHoverDetection(parcoords, onHoveredLinesChange).then(() => {
    setupCanvasClickHandling();
  });
}
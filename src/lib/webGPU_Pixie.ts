import { getLineName } from "./brush";
import { canvasEl, lineState } from "./globals";
import { WebGLRenderer, WebGPURenderer } from 'pixi.js';

function getPolylinePoints(d: any, parcoords: any, dpr: number): [number, number][] {
  const pts: [number, number][] = [];
  parcoords.newFeatures.forEach((name: string) => {
    const x = (parcoords.dragging[name] ?? parcoords.xScales(name)) * dpr;
    const y = parcoords.yScales[name](d[name]) * dpr;
    pts.push([x, y]);
  });
  return pts;
}

export async function initCanvasWebGPUPixie(dpr: number) {
    const width = canvasEl.clientWidth;
    const height = canvasEl.clientHeight;

    const renderer = new WebGPURenderer();
    await renderer.init();

    
 
}

export function redrawWebGPULinesPixie(dataset: any[], parcoords: any) {
}





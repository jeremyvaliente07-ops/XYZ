import { jsPDF } from 'jspdf';
import { CADProject, ExportFormat, ExportTarget, Point3D } from '../types/cad';
import {
  buildSurfaceGeometry3D,
  getLineRealLength3D,
  getOrientedExtrudeNormal,
  getPolygonRealArea3D,
} from './geometry3d';

type OrthoView = 'FRONT' | 'TOP' | 'SIDE';

const VIEW_META: Record<OrthoView, { title: string; color: string }> = {
  FRONT: { title: 'Vue de Face (XY)', color: '#DC2626' },
  TOP: { title: 'Vue de Haut (XZ)', color: '#2563EB' },
  SIDE: { title: 'Vue de Côté (YZ)', color: '#16A34A' },
};

function projectTo2D(pt: { x: number; y: number; z: number }, view: OrthoView) {
  if (view === 'FRONT') return { u: pt.x, v: pt.y };
  if (view === 'TOP') return { u: pt.x, v: -pt.z };
  return { u: pt.z, v: pt.y };
}

export function renderOrthoProjectionCanvas(
  project: CADProject,
  view: OrthoView,
  width = 1600,
  height = 1100
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const meta = VIEW_META[view];

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  const getExtrudedTopVertices = (vertices: Point3D[], extrudeHeight: number): Point3D[] => {
    const n = getOrientedExtrudeNormal(vertices);
    return vertices.map((v) => ({
      x: v.x + n.x * extrudeHeight,
      y: v.y + n.y * extrudeHeight,
      z: v.z + n.z * extrudeHeight,
    }));
  };

  const allPts = [
    ...project.lines.flatMap((l) => [projectTo2D(l.start, view), projectTo2D(l.end, view)]),
    ...project.surfaces.flatMap((s) => {
      const basePts = s.vertices.map((v) => projectTo2D(v, view));
      if (Math.abs(s.extrudeHeight || 0) > 0.01) {
        const topPts = getExtrudedTopVertices(s.vertices, s.extrudeHeight).map((v) =>
          projectTo2D(v, view)
        );
        return [...basePts, ...topPts];
      }
      return basePts;
    }),
  ];

  let minU = -5,
    maxU = 5,
    minV = -4,
    maxV = 4;
  if (allPts.length > 0) {
    const us = allPts.map((p) => p.u);
    const vs = allPts.map((p) => p.v);
    minU = Math.min(-3, Math.floor(Math.min(...us) - 2));
    maxU = Math.max(3, Math.ceil(Math.max(...us) + 2));
    minV = Math.min(-3, Math.floor(Math.min(...vs) - 2));
    maxV = Math.max(3, Math.ceil(Math.max(...vs) + 2));
  }

  const margin = 70;
  const footerH = 95;
  const availW = width - margin * 2;
  const availH = height - margin * 2 - footerH;
  const cellPx = Math.min(availW / Math.max(8, maxU - minU), availH / Math.max(6, maxV - minV));

  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  const originX = margin + availW / 2 - centerU * cellPx;
  const originY = margin + availH / 2 + centerV * cellPx;

  const toX = (u: number) => originX + u * cellPx;
  const toY = (v: number) => originY - v * cellPx;

  ctx.save();
  ctx.beginPath();
  ctx.rect(margin, margin, availW, availH);
  ctx.clip();

  const startU = Math.floor((margin - originX) / cellPx) - 1;
  const endU = Math.ceil((margin + availW - originX) / cellPx) + 1;
  const startV = Math.floor((originY - (margin + availH)) / cellPx) - 1;
  const endV = Math.ceil((originY - margin) / cellPx) + 1;

  for (let u = startU; u <= endU; u++) {
    const x = toX(u);
    ctx.beginPath();
    ctx.moveTo(x, margin);
    ctx.lineTo(x, margin + availH);
    ctx.strokeStyle = u % 5 === 0 ? '#CBD5E1' : '#F1F5F9';
    ctx.lineWidth = u % 5 === 0 ? 1.2 : 0.8;
    ctx.stroke();
  }
  for (let v = startV; v <= endV; v++) {
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(margin + availW, y);
    ctx.strokeStyle = v % 5 === 0 ? '#CBD5E1' : '#F1F5F9';
    ctx.lineWidth = v % 5 === 0 ? 1.2 : 0.8;
    ctx.stroke();
  }

  if (project.grid.showAxes) {
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(margin, toY(0));
    ctx.lineTo(margin + availW, toY(0));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(toX(0), margin);
    ctx.lineTo(toX(0), margin + availH);
    ctx.stroke();
  }

  project.surfaces.forEach((surf) => {
    if (surf.vertices.length < 3) return;
    const drawPoly = (verts: Point3D[]) => {
      ctx.beginPath();
      const p0 = projectTo2D(verts[0], view);
      ctx.moveTo(toX(p0.u), toY(p0.v));
      for (let i = 1; i < verts.length; i++) {
        const pi = projectTo2D(verts[i], view);
        ctx.lineTo(toX(pi.u), toY(pi.v));
      }
      ctx.closePath();
      if (surf.filled) {
        ctx.fillStyle = `${meta.color}22`;
        ctx.fill();
      }
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    drawPoly(surf.vertices);

    if (Math.abs(surf.extrudeHeight || 0) > 0.01) {
      const topVerts = getExtrudedTopVertices(surf.vertices, surf.extrudeHeight);
      for (let i = 0; i < surf.vertices.length; i++) {
        const b1 = projectTo2D(surf.vertices[i], view);
        const t1 = projectTo2D(topVerts[i], view);
        const b2 = projectTo2D(surf.vertices[(i + 1) % surf.vertices.length], view);
        const t2 = projectTo2D(topVerts[(i + 1) % surf.vertices.length], view);

        ctx.beginPath();
        ctx.moveTo(toX(b1.u), toY(b1.v));
        ctx.lineTo(toX(b2.u), toY(b2.v));
        ctx.lineTo(toX(t2.u), toY(t2.v));
        ctx.lineTo(toX(t1.u), toY(t1.v));
        ctx.closePath();
        if (surf.filled) {
          ctx.fillStyle = `${meta.color}16`;
          ctx.fill();
        }
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      drawPoly(topVerts);
    }
  });

  project.lines.forEach((line) => {
    const a = projectTo2D(line.start, view);
    const b = projectTo2D(line.end, view);
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(a.u), toY(a.v));
    ctx.lineTo(toX(b.u), toY(b.v));
    ctx.stroke();
  });

  ctx.restore();

  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.strokeRect(margin, margin, availW, availH);

  const ty = margin + availH + 14;
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(margin, ty, availW, footerH - 14);
  ctx.strokeRect(margin, ty, availW, footerH - 14);

  ctx.fillStyle = meta.color;
  ctx.fillRect(margin, ty, 10, footerH - 14);

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 19px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`XYZ STUDIO 3D — ${project.name}`, margin + 24, ty + 32);

  ctx.fillStyle = '#475569';
  ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    `${meta.title} · 1 case = ${project.grid.cellSize} ${project.grid.unit}`,
    margin + 24,
    ty + 58
  );

  return canvas;
}

function draw3DSourceOnContext(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | string | null | undefined,
  x: number,
  y: number,
  w: number,
  h: number
) {
  if (!source) return;
  if (typeof source !== 'string') {
    const srcRatio = source.width / Math.max(1, source.height);
    const dstRatio = w / h;
    let drawW = w;
    let drawH = h;
    let drawX = x;
    let drawY = y;
    if (srcRatio > dstRatio) {
      drawH = w / srcRatio;
      drawY = y + (h - drawH) / 2;
    } else {
      drawW = h * srcRatio;
      drawX = x + (w - drawW) / 2;
    }
    ctx.drawImage(source, drawX, drawY, drawW, drawH);
    return;
  }
  const img = new Image();
  img.src = source;
  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, x, y, w, h);
  }
}

export function renderFullProjectSheetCanvas(
  project: CADProject,
  threeSnapshot?: HTMLCanvasElement | string | null
): HTMLCanvasElement {
  const width = 2400;
  const height = 1650;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(renderOrthoProjectionCanvas(project, 'FRONT', 1140, 760), 40, 40);
  ctx.drawImage(renderOrthoProjectionCanvas(project, 'TOP', 1140, 760), 1220, 40);
  ctx.drawImage(renderOrthoProjectionCanvas(project, 'SIDE', 1140, 760), 40, 840);

  const qx = 1260;
  const qy = 880;
  const qw = 1060;
  const qh = 680;
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(qx, qy, qw, qh);
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.strokeRect(qx, qy, qw, qh);

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 20px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`VUE 3D — ${project.name.toUpperCase()}`, qx + 28, qy + 42);

  draw3DSourceOnContext(ctx, threeSnapshot, qx + 24, qy + 62, qw - 48, qh - 86);

  return canvas;
}

export function generateWavefrontOBJ(
  project: CADProject
): { content: string; vertexCount: number; edgeCount: number; faceCount: number; error?: string } {
  const scale = project.grid.cellSize;

  if (project.lines.length === 0 && project.surfaces.length === 0) {
    return {
      content: '',
      vertexCount: 0,
      edgeCount: 0,
      faceCount: 0,
      error: 'Dessinez au moins une ligne ou un volume 3D avant d’exporter en OBJ.',
    };
  }

  const out: string[] = [];
  out.push('# XYZ Studio 3D — Wavefront OBJ');
  out.push(`# Projet : ${project.name}`);
  out.push(`# Unité  : ${project.grid.unit} (1 case = ${scale} ${project.grid.unit})`);
  out.push('');

  let vOffset = 1;
  let vnOffset = 1;
  let vCount = 0;
  let eCount = 0;
  let fCount = 0;

  if (project.lines.length > 0) {
    out.push('o Lignes_3D');
    for (const line of project.lines) {
      out.push(
        `v ${(line.start.x * scale).toFixed(4)} ${(line.start.y * scale).toFixed(4)} ${(line.start.z * scale).toFixed(4)}`
      );
      out.push(
        `v ${(line.end.x * scale).toFixed(4)} ${(line.end.y * scale).toFixed(4)} ${(line.end.z * scale).toFixed(4)}`
      );
      out.push(`l ${vOffset} ${vOffset + 1}`);
      vOffset += 2;
      vCount += 2;
      eCount += 1;
    }
    out.push('');
  }

  for (const surf of project.surfaces) {
    if (surf.vertices.length < 3) continue;
    out.push(`o Objet_${surf.id}`);

    const loopStart = vOffset;
    for (const pt of surf.vertices) {
      out.push(
        `v ${(pt.x * scale).toFixed(4)} ${(pt.y * scale).toFixed(4)} ${(pt.z * scale).toFixed(4)}`
      );
      vOffset++;
      vCount++;
    }
    for (let i = 0; i < surf.vertices.length; i++) {
      const a = loopStart + i;
      const b = loopStart + ((i + 1) % surf.vertices.length);
      out.push(`l ${a} ${b}`);
      eCount++;
    }

    if (surf.filled) {
      const geo = buildSurfaceGeometry3D(surf);
      if (geo) {
        const pos = geo.attributes.position;
        const norm = geo.attributes.normal;
        const idx = geo.index;

        const mVertStart = vOffset;
        const mNormStart = vnOffset;

        for (let i = 0; i < pos.count; i++) {
          out.push(
            `v ${(pos.getX(i) * scale).toFixed(4)} ${(pos.getY(i) * scale).toFixed(4)} ${(pos.getZ(i) * scale).toFixed(4)}`
          );
          vOffset++;
          vCount++;
        }

        if (norm) {
          for (let i = 0; i < norm.count; i++) {
            out.push(`vn ${norm.getX(i).toFixed(4)} ${norm.getY(i).toFixed(4)} ${norm.getZ(i).toFixed(4)}`);
            vnOffset++;
          }
        }

        if (idx) {
          for (let i = 0; i < idx.count; i += 3) {
            const i1 = idx.getX(i) + mVertStart;
            const i2 = idx.getX(i + 1) + mVertStart;
            const i3 = idx.getX(i + 2) + mVertStart;
            if (norm) {
              const n1 = idx.getX(i) + mNormStart;
              const n2 = idx.getX(i + 1) + mNormStart;
              const n3 = idx.getX(i + 2) + mNormStart;
              out.push(`f ${i1}//${n1} ${i2}//${n2} ${i3}//${n3}`);
            } else {
              out.push(`f ${i1} ${i2} ${i3}`);
            }
            fCount++;
          }
        } else {
          for (let i = 0; i < pos.count; i += 3) {
            const i1 = mVertStart + i;
            const i2 = mVertStart + i + 1;
            const i3 = mVertStart + i + 2;
            if (norm) {
              const n1 = mNormStart + i;
              const n2 = mNormStart + i + 1;
              const n3 = mNormStart + i + 2;
              out.push(`f ${i1}//${n1} ${i2}//${n2} ${i3}//${n3}`);
            } else {
              out.push(`f ${i1} ${i2} ${i3}`);
            }
            fCount++;
          }
        }
        geo.dispose();
      }
    }
    out.push('');
  }

  return {
    content: out.join('\n'),
    vertexCount: vCount,
    edgeCount: eCount,
    faceCount: fCount,
  };
}

export function triggerDownload(urlOrBlob: string | Blob, filename: string) {
  const link = document.createElement('a');
  const url = typeof urlOrBlob === 'string' ? urlOrBlob : URL.createObjectURL(urlOrBlob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (typeof urlOrBlob !== 'string') {
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
}

export function executeExport(
  project: CADProject,
  target: ExportTarget,
  format: ExportFormat,
  capture3DSource?: () => HTMLCanvasElement | string | null
): { success: boolean; message: string } {
  const safeName = project.name.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'projet_3d';

  if (format === 'XYZ') {
    const payload = JSON.stringify(
      { app: 'XYZ Studio 3D', version: '3.0.0', exportedAt: new Date().toISOString(), project },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    triggerDownload(blob, `${safeName}.xyz.json`);
    return { success: true, message: `Projet sauvegardé (${safeName}.xyz.json).` };
  }

  if (format === 'OBJ') {
    const objRes = generateWavefrontOBJ(project);
    if (objRes.error) return { success: false, message: objRes.error };
    const blob = new Blob([objRes.content], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, `${safeName}.obj`);
    return {
      success: true,
      message: `Modèle 3D ${safeName}.obj exporté (${objRes.vertexCount} sommets, ${objRes.faceCount} faces).`,
    };
  }

  let sourceCanvas: HTMLCanvasElement;
  const threeSource = capture3DSource ? capture3DSource() : null;

  if (target === 'FRONT' || target === 'TOP' || target === 'SIDE') {
    sourceCanvas = renderOrthoProjectionCanvas(project, target, 1800, 1250);
  } else if (target === '3D') {
    sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 1800;
    sourceCanvas.height = 1250;
    const ctx = sourceCanvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 1800, 1250);
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 50, 1700, 1040);

    draw3DSourceOnContext(ctx, threeSource, 54, 54, 1692, 1032);

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(50, 1110, 1700, 85);
    ctx.strokeRect(50, 1110, 1700, 85);
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`XYZ STUDIO 3D — ${project.name}`, 80, 1150);
    ctx.font = '500 15px "JetBrains Mono", monospace';
    ctx.fillStyle = '#475569';
    ctx.fillText(
      `Vue 3D · Unité : ${project.grid.unit} · ${project.lines.length} lignes · ${project.surfaces.length} surfaces/volumes`,
      80,
      1178
    );
  } else {
    sourceCanvas = renderFullProjectSheetCanvas(project, threeSource);
  }

  if (format === 'PNG') {
    triggerDownload(sourceCanvas.toDataURL('image/png'), `${safeName}_${target}.png`);
    return { success: true, message: `Image ${safeName}_${target}.png téléchargée.` };
  }

  if (format === 'JPG') {
    triggerDownload(sourceCanvas.toDataURL('image/jpeg', 0.96), `${safeName}_${target}.jpg`);
    return { success: true, message: `Image ${safeName}_${target}.jpg téléchargée.` };
  }

  if (format === 'PDF') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297;
    const pageH = 210;

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.5);
    doc.rect(8, 8, pageW - 16, pageH - 16);
    doc.addImage(sourceCanvas.toDataURL('image/png'), 'PNG', 12, 12, pageW - 24, pageH - 48);

    const totalLen = project.lines.reduce(
      (acc, l) => acc + getLineRealLength3D(l, project.grid.cellSize),
      0
    );
    const totalArea = project.surfaces.reduce(
      (acc, s) => acc + (s.filled ? getPolygonRealArea3D(s.vertices, project.grid.cellSize) : 0),
      0
    );

    doc.setFillColor(248, 250, 252);
    doc.rect(12, pageH - 32, pageW - 24, 20, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`XYZ Studio 3D — ${project.name} (${target})`, 16, pageH - 23);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Unite : ${project.grid.unit}  |  1 case = ${project.grid.cellSize} ${project.grid.unit}  |  Lignes : ${totalLen.toFixed(1)} ${project.grid.unit}  |  Surfaces : ${totalArea.toFixed(1)} ${project.grid.unit}²`,
      16,
      pageH - 16
    );

    doc.save(`${safeName}_${target}.pdf`);
    return { success: true, message: `PDF ${safeName}_${target}.pdf téléchargé.` };
  }

  return { success: false, message: 'Format inconnu.' };
}

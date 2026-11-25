import * as THREE from 'three';
import { CADLine3D, CADSurface3D, Point3D } from '../types/cad';

export function distance3D(a: Point3D, b: Point3D): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function getLineRealLength3D(line: CADLine3D, cellSize: number): number {
  return distance3D(line.start, line.end) * cellSize;
}

export function pointsEqual3D(a: Point3D, b: Point3D, eps = 0.05): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.z - b.z) <= eps
  );
}

/**
 * Computes Newell's normal vector for an arbitrary 3D planar polygon.
 */
export function computePolygonNormal3D(vertices: Point3D[]): THREE.Vector3 {
  const normal = new THREE.Vector3();
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    normal.x += (curr.y - next.y) * (curr.z + next.z);
    normal.y += (curr.z - next.z) * (curr.x + next.x);
    normal.z += (curr.x - next.x) * (curr.y + next.y);
  }
  if (normal.lengthSq() < 1e-8) {
    return new THREE.Vector3(0, 1, 0);
  }
  return normal.normalize();
}

/**
 * Ensures vertical extrusion goes UP (+Y) when a horizontal surface is extruded positively.
 */
export function getOrientedExtrudeNormal(vertices: Point3D[]): THREE.Vector3 {
  const n = computePolygonNormal3D(vertices);
  // If mostly horizontal, orient upward (+Y) so positive height extrudes up
  if (Math.abs(n.y) > 0.7 && n.y < 0) {
    n.negate();
  }
  return n;
}

/**
 * Computes real surface area in project units squared.
 */
export function getPolygonRealArea3D(vertices: Point3D[], cellSize: number): number {
  if (vertices.length < 3) return 0;
  const n = computePolygonNormal3D(vertices);
  const total = new THREE.Vector3();
  const v0 = new THREE.Vector3(vertices[0].x, vertices[0].y, vertices[0].z);
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = new THREE.Vector3(vertices[i].x, vertices[i].y, vertices[i].z).sub(v0);
    const b = new THREE.Vector3(vertices[i + 1].x, vertices[i + 1].y, vertices[i + 1].z).sub(v0);
    total.add(a.cross(b));
  }
  const areaCells = Math.abs(total.dot(n)) * 0.5;
  return areaCells * (cellSize * cellSize);
}

/**
 * Builds a true 3D BufferGeometry for either a flat 3D polygon OR an extruded 3D solid prism.
 */
export function buildSurfaceGeometry3D(surface: CADSurface3D): THREE.BufferGeometry | null {
  if (surface.vertices.length < 3) return null;

  const normal = getOrientedExtrudeNormal(surface.vertices);
  const origin = new THREE.Vector3(
    surface.vertices[0].x,
    surface.vertices[0].y,
    surface.vertices[0].z
  );

  const ref = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const uAxis = new THREE.Vector3().crossVectors(ref, normal).normalize();
  const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();

  const contour2D: THREE.Vector2[] = surface.vertices.map((p) => {
    const rel = new THREE.Vector3(p.x, p.y, p.z).sub(origin);
    return new THREE.Vector2(rel.dot(uAxis), rel.dot(vAxis));
  });

  // Ensure consistent CCW winding in 2D
  if (THREE.ShapeUtils.isClockWise(contour2D)) {
    contour2D.reverse();
  }

  const extrudeH = surface.extrudeHeight || 0;

  if (Math.abs(extrudeH) < 0.005) {
    // Flat 3D polygon
    const faces = THREE.ShapeUtils.triangulateShape(contour2D, []);
    if (faces.length === 0) return null;

    const positions = new Float32Array(contour2D.length * 3);
    contour2D.forEach((pt2, idx) => {
      const world = origin
        .clone()
        .addScaledVector(uAxis, pt2.x)
        .addScaledVector(vAxis, pt2.y);
      positions[idx * 3] = world.x;
      positions[idx * 3 + 1] = world.y;
      positions[idx * 3 + 2] = world.z;
    });

    const indices: number[] = [];
    faces.forEach(([a, b, c]) => indices.push(a, b, c));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  // Extruded 3D Solid Volume
  const shape = new THREE.Shape(contour2D);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.abs(extrudeH),
    bevelEnabled: false,
    steps: 1,
  });

  if (extrudeH < 0) {
    geo.translate(0, 0, extrudeH);
  }

  // Transform from local (u, v, depth) back to true 3D world space
  const posAttr = geo.attributes.position;
  const worldVec = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i);
    const ly = posAttr.getY(i);
    const lz = posAttr.getZ(i);
    worldVec
      .copy(origin)
      .addScaledVector(uAxis, lx)
      .addScaledVector(vAxis, ly)
      .addScaledVector(normal, lz);
    posAttr.setXYZ(i, worldVec.x, worldVec.y, worldVec.z);
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Verifies if a set of selected 3D lines forms a single closed loop.
 */
export function extractClosedLoopFromLines3D(lines: CADLine3D[]): {
  valid: boolean;
  vertices?: Point3D[];
  error?: string;
} {
  if (lines.length < 3) {
    return {
      valid: false,
      error: 'Sélectionnez au moins 3 lignes qui forment un contour fermé.',
    };
  }

  const uniquePoints: Point3D[] = [];
  const getPointIndex = (pt: Point3D): number => {
    const existing = uniquePoints.findIndex((p) => pointsEqual3D(p, pt, 0.08));
    if (existing !== -1) return existing;
    uniquePoints.push({
      x: Math.round(pt.x * 100) / 100,
      y: Math.round(pt.y * 100) / 100,
      z: Math.round(pt.z * 100) / 100,
    });
    return uniquePoints.length - 1;
  };

  const adj = new Map<number, { neighbor: number; lineIdx: number }[]>();
  lines.forEach((line, idx) => {
    const uIdx = getPointIndex(line.start);
    const vIdx = getPointIndex(line.end);
    if (!adj.has(uIdx)) adj.set(uIdx, []);
    if (!adj.has(vIdx)) adj.set(vIdx, []);
    adj.get(uIdx)!.push({ neighbor: vIdx, lineIdx: idx });
    adj.get(vIdx)!.push({ neighbor: uIdx, lineIdx: idx });
  });

  for (const [, neighbors] of adj.entries()) {
    if (neighbors.length !== 2) {
      return {
        valid: false,
        error: 'Les lignes sélectionnées ne forment pas une boucle fermée continue.',
      };
    }
  }

  const visitedLines = new Set<number>();
  const orderedIndices: number[] = [];
  let curr = 0;
  let prevLine = -1;

  while (orderedIndices.length < uniquePoints.length) {
    orderedIndices.push(curr);
    const neighbors = adj.get(curr) || [];
    const nextEdge = neighbors.find((n) => n.lineIdx !== prevLine && !visitedLines.has(n.lineIdx));
    if (!nextEdge) break;
    visitedLines.add(nextEdge.lineIdx);
    prevLine = nextEdge.lineIdx;
    curr = nextEdge.neighbor;
  }

  if (visitedLines.size !== lines.length || orderedIndices.length < 3) {
    return {
      valid: false,
      error: 'Les lignes sélectionnées doivent former une seule forme fermée.',
    };
  }

  return {
    valid: true,
    vertices: orderedIndices.map((idx) => uniquePoints[idx]),
  };
}

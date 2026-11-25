import { CADProject, UnitType } from '../types/cad';

export function createBlankProject(
  name = 'Nouveau Projet 3D',
  unit: UnitType = 'cm',
  cellSize = 1
): CADProject {
  const now = Date.now();
  return {
    id: `proj_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: now,
    updatedAt: now,
    grid: {
      cellSize,
      unit,
      lineWidth: 1,
      showAxes: true,
      showOrigin: true,
      snapToGrid: true,
      showMeasurements: false,
    },
    lines: [],
    surfaces: [],
  };
}

export function createStarterProject(): CADProject {
  const now = Date.now();
  // Clean starter: a single simple 3D base square on the floor + one extruded volume
  // so a beginner immediately sees how lines and volumes work in 3D without clutter
  return {
    id: 'proj_starter_volume',
    name: 'Mon Premier Modèle 3D',
    createdAt: now - 3600000,
    updatedAt: now,
    grid: {
      cellSize: 1,
      unit: 'cm',
      lineWidth: 1,
      showAxes: true,
      showOrigin: true,
      snapToGrid: true,
      showMeasurements: false,
    },
    lines: [
      { id: 'l1', start: { x: -2, y: 0, z: -2 }, end: { x: 2, y: 0, z: -2 }, createdAt: now },
      { id: 'l2', start: { x: 2, y: 0, z: -2 }, end: { x: 2, y: 0, z: 2 }, createdAt: now },
      { id: 'l3', start: { x: 2, y: 0, z: 2 }, end: { x: -2, y: 0, z: 2 }, createdAt: now },
      { id: 'l4', start: { x: -2, y: 0, z: 2 }, end: { x: -2, y: 0, z: -2 }, createdAt: now },
    ],
    surfaces: [
      {
        id: 's1',
        name: 'Bloc central',
        filled: true,
        extrudeHeight: 2,
        vertices: [
          { x: -2, y: 0, z: -2 },
          { x: 2, y: 0, z: -2 },
          { x: 2, y: 0, z: 2 },
          { x: -2, y: 0, z: 2 },
        ],
        createdAt: now,
      },
    ],
  };
}

export type CameraViewId = '3D' | 'TOP' | 'FRONT' | 'SIDE';

export type UnitType = 'mm' | 'cm' | 'm';

export type ToolId =
  | 'select'
  | 'line'
  | 'angled_line'
  | 'surface'
  | 'extrude'
  | 'move'
  | 'edit_endpoints'
  | 'eraser'
  | 'orbit';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface CADLine3D {
  id: string;
  start: Point3D;
  end: Point3D;
  createdAt: number;
}

export interface CADSurface3D {
  id: string;
  vertices: Point3D[];
  filled: boolean;
  extrudeHeight: number; // 0 = flat face, >0 or <0 = extruded 3D solid along normal
  name?: string;
  createdAt: number;
}

export interface GridSettings {
  cellSize: number; // Fixed value per grid square in project units
  unit: UnitType;
  lineWidth: number;
  showAxes: boolean;
  showOrigin: boolean;
  snapToGrid: boolean;
  showMeasurements: boolean;
}

export interface CADProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  grid: GridSettings;
  lines: CADLine3D[];
  surfaces: CADSurface3D[];
}

export type DisplayMode3D = 'solid' | 'wireframe';

export type ExportTarget = '3D' | 'FRONT' | 'TOP' | 'SIDE' | 'FULL';
export type ExportFormat = 'PNG' | 'JPG' | 'PDF' | 'OBJ' | 'XYZ';

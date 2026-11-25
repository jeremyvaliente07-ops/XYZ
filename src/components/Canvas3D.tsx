import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  CADLine3D,
  CADProject,
  CADSurface3D,
  CameraViewId,
  DisplayMode3D,
  Point3D,
  ToolId,
} from '../types/cad';
import {
  buildSurfaceGeometry3D,
  distance3D,
  getLineRealLength3D,
  getOrientedExtrudeNormal,
  pointsEqual3D,
} from '../utils/geometry3d';

interface Canvas3DProps {
  project: CADProject;
  activeTool: ToolId;
  displayMode: DisplayMode3D;
  viewTrigger: { view: CameraViewId; nonce: number };
  selectedLineIds: string[];
  selectedSurfaceId: string | null;
  onSelectLines: (ids: string[]) => void;
  onSelectSurface: (id: string | null) => void;
  onAddLine: (start: Point3D, end: Point3D) => void;
  onUpdateLineEndpoints: (lineId: string, start: Point3D, end: Point3D, skipHistory?: boolean) => void;
  onMoveSelection: (
    delta: Point3D,
    targetLineId?: string,
    targetSurfId?: string,
    skipHistory?: boolean
  ) => void;
  onAddSurface: (vertices: Point3D[], filled: boolean) => void;
  onUpdateSurface: (surfaceId: string, patch: Partial<CADSurface3D>, skipHistory?: boolean) => void;
  onDeleteItem: (lineId?: string, surfaceId?: string) => void;
  onPushHistory: () => void;
  customAngleDeg: number;
  surfaceFillMode: boolean;
  activeLineColor: string;
  activeSurfaceColor: string;
  polygonDraft: Point3D[];
  setPolygonDraft: React.Dispatch<React.SetStateAction<Point3D[]>>;
  onRegisterSnapshotGetter: (getter: () => HTMLCanvasElement | string | null) => void;
  onNotify: (msg: string, type?: 'info' | 'error' | 'success') => void;
}

const TOOL_HINTS: Record<ToolId, string> = {
  line: 'Cliquez 2 points pour tracer en 3D (rouge = X, bleu = hauteur Y, vert = Z). Clic droit = tourner.',
  angled_line: 'Choisissez l’angle en haut puis cliquez 2 points sur la grille.',
  surface: 'Cliquez sur les coins d’une forme puis sur le 1er point pour créer une face.',
  extrude: 'Cliquez sur une face et glissez vers le haut pour créer un volume 3D.',
  select: 'Cliquez sur une ligne pour mesurer (Maj+clic = plusieurs) ou sur une face.',
  move: 'Cliquez sur une ligne ou une face et glissez pour la déplacer.',
  edit_endpoints: 'Glissez un point rond au bout d’une ligne pour la modifier.',
  eraser: 'Cliquez sur une ligne ou un volume pour l’effacer.',
  orbit: 'Glissez avec le clic gauche pour tourner librement autour du modèle 3D.',
};

type AxisInference = 'NONE' | 'X' | 'Y' | 'Z';

const _vec3 = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _mouseNDC = new THREE.Vector2();

function distPointToSegment2D(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * Distance from 2D point P to an infinite 2D line passing through A and B.
 */
function distPointToInfiniteLine2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return Infinity;
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

/**
 * Computes closest parameter t along line P(t) = origin + t * dir (unit) to a 3D ray.
 */
function closestTOnAxisToRay(
  ray: THREE.Ray,
  axisOrigin: THREE.Vector3,
  axisDir: THREE.Vector3
): number {
  const w0 = new THREE.Vector3().subVectors(axisOrigin, ray.origin);
  const a = 1; // axisDir is unit
  const b = axisDir.dot(ray.direction);
  const c = 1; // ray.direction is unit
  const d = axisDir.dot(w0);
  const e = ray.direction.dot(w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-5) return 0;
  return (b * e - c * d) / denom;
}

export const Canvas3D: React.FC<Canvas3DProps> = ({
  project,
  activeTool,
  displayMode,
  viewTrigger,
  selectedLineIds,
  selectedSurfaceId,
  onSelectLines,
  onSelectSurface,
  onAddLine,
  onUpdateLineEndpoints,
  onMoveSelection,
  onAddSurface,
  onUpdateSurface,
  onDeleteItem,
  onPushHistory,
  customAngleDeg,
  surfaceFillMode,
  activeLineColor,
  activeSurfaceColor,
  polygonDraft,
  setPolygonDraft,
  onRegisterSnapshotGetter,
  onNotify,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasMountRef = useRef<HTMLDivElement>(null);

  const [hoveredPt, setHoveredPt] = useState<Point3D>({ x: 0, y: 0, z: 0 });
  const [hoveredRawPt, setHoveredRawPt] = useState<Point3D>({ x: 0, y: 0, z: 0 });
  const [snappedVertex, setSnappedVertex] = useState<boolean>(false);
  const [activeAxis, setActiveAxis] = useState<AxisInference>('NONE');
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);
  const [hoveredSurfaceId, setHoveredSurfaceId] = useState<string | null>(null);

  const [lineDraftStart, setLineDraftStart] = useState<Point3D | null>(null);
  const [lineDraftDownPx, setLineDraftDownPx] = useState<{ x: number; y: number } | null>(null);

  const [draggingEndpoint, setDraggingEndpoint] = useState<{
    lineId: string;
    which: 'start' | 'end';
    anchorPt: Point3D;
  } | null>(null);

  const [movingDrag, setMovingDrag] = useState<{
    lastPt: Point3D;
    anchorPt: Point3D;
    targetLineId?: string;
    targetSurfId?: string;
  } | null>(null);

  const [extrudeDrag, setExtrudeDrag] = useState<{
    surfaceId: string;
    startYpx: number;
    origHeight: number;
  } | null>(null);

  const [spacePressed, setSpacePressed] = useState<boolean>(false);
  const [labelVersion, setLabelVersion] = useState<number>(0);

  const registerSnapshotRef = useRef(onRegisterSnapshotGetter);
  registerSnapshotRef.current = onRegisterSnapshotGetter;

  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    cadGroup: THREE.Group;
    surfaceMeshesGroup: THREE.Group;
    gridGroup: THREE.Group;
    previewGroup: THREE.Group;
    resolution: THREE.Vector2;
    requestRender: () => void;
    cameraGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null;
  } | null>(null);

  // Collect all 3D corners (including top vertices of extruded volumes!)
  const allVertices = useMemo(() => {
    const pts: Point3D[] = [];
    const addUnique = (p: Point3D) => {
      if (!pts.some((ex) => pointsEqual3D(ex, p, 0.02))) {
        pts.push(p);
      }
    };
    project.lines.forEach((l) => {
      addUnique(l.start);
      addUnique(l.end);
    });
    project.surfaces.forEach((s) => {
      s.vertices.forEach(addUnique);
      if (Math.abs(s.extrudeHeight || 0) > 0.01) {
        const n = getOrientedExtrudeNormal(s.vertices);
        s.vertices.forEach((v) =>
          addUnique({
            x: Math.round((v.x + n.x * s.extrudeHeight) * 100) / 100,
            y: Math.round((v.y + n.y * s.extrudeHeight) * 100) / 100,
            z: Math.round((v.z + n.z * s.extrudeHeight) * 100) / 100,
          })
        );
      }
    });
    return pts;
  }, [project.lines, project.surfaces]);

  const createAxisSprite = useCallback((label: string, colorHex: string, pos: THREE.Vector3) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = colorHex;
    ctx.beginPath();
    ctx.arc(32, 32, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 32, 33);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.set(0.75, 0.75, 1);
    sprite.renderOrder = 30;
    return sprite;
  }, []);

  // Initialize Three.js WebGLRenderer once
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    const containerEl = containerRef.current;
    if (!mountEl || !containerEl) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const rect = containerEl.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(300, Math.floor(rect.height));

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 1000);
    camera.position.set(9, 7, 11);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.8, 0);
    controls.minDistance = 2;
    controls.maxDistance = 120;

    // Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xf1f5f9, 0x94a3b8, 0.92);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.3);
    keyLight.position.set(14, 22, 16);
    keyLight.castShadow = !isSoftwareGl;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.65);
    rimLight.position.set(-14, -8, -12);
    scene.add(rimLight);

    const gridGroup = new THREE.Group();
    const cadGroup = new THREE.Group();
    const surfaceMeshesGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    scene.add(gridGroup, cadGroup, surfaceMeshesGroup, previewGroup);

    renderer.setSize(w, h);
    mountEl.innerHTML = '';
    mountEl.appendChild(renderer.domElement);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      if (gl.flush) gl.flush();
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const poll = () => {
        if (disposed) {
          gl.deleteSync(sync);
          return;
        }
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        const st = threeRef.current;
        let animating = false;
        if (st && st.cameraGoal) {
          camera.position.x = THREE.MathUtils.damp(camera.position.x, st.cameraGoal.pos.x, 10, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, st.cameraGoal.pos.y, 10, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, st.cameraGoal.pos.z, 10, dt);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, st.cameraGoal.target.x, 10, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, st.cameraGoal.target.y, 10, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, st.cameraGoal.target.z, 10, dt);

          if (
            camera.position.distanceTo(st.cameraGoal.pos) < 0.03 &&
            controls.target.distanceTo(st.cameraGoal.target) < 0.03
          ) {
            camera.position.copy(st.cameraGoal.pos);
            controls.target.copy(st.cameraGoal.target);
            st.cameraGoal = null;
          } else {
            animating = true;
          }
        }

        controls.update();
        renderer.render(scene, camera);
        if (animating) {
          setLabelVersion((v) => (v + 1) % 100000);
        }

        const done = () => {
          renderBusy = false;
          if (!disposed && (renderDirty || animating)) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('start', () => {
      if (threeRef.current) threeRef.current.cameraGoal = null;
    });
    controls.addEventListener('change', () => {
      if (!disposed) {
        setLabelVersion((v) => (v + 1) % 100000);
        requestRender();
      }
    });

    const resolution = new THREE.Vector2(w, h);

    const updateGroupLineResolution = (grp: THREE.Group, width: number, height: number) => {
      grp.children.forEach((child) => {
        const mat = (child as { material?: THREE.Material | THREE.Material[] }).material;
        if (mat && 'resolution' in mat && mat.resolution instanceof THREE.Vector2) {
          mat.resolution.set(width, height);
        }
      });
    };

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      const r = containerEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const rw = Math.floor(r.width);
        const rh = Math.floor(r.height);
        camera.aspect = r.width / r.height;
        camera.updateProjectionMatrix();
        renderer.setSize(rw, rh);
        resolution.set(rw, rh);
        updateGroupLineResolution(cadGroup, rw, rh);
        updateGroupLineResolution(previewGroup, rw, rh);
        setLabelVersion((v) => (v + 1) % 100000);
        requestRender();
      }
    });
    ro.observe(containerEl);

    threeRef.current = {
      renderer,
      scene,
      camera,
      controls,
      cadGroup,
      surfaceMeshesGroup,
      gridGroup,
      previewGroup,
      resolution,
      requestRender,
      cameraGoal: null,
    };

    registerSnapshotRef.current(() => {
      if (!threeRef.current) return null;
      const { renderer: r, scene: s, camera: c } = threeRef.current;
      r.render(s, c);
      return r.domElement;
    });

    requestRender();

    return () => {
      disposed = true;
      ro.disconnect();
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
      threeRef.current = null;
    };
  }, []);

  // Configure OrbitControls mouse buttons dynamically
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    if (activeTool === 'orbit' || spacePressed) {
      st.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN,
      };
    } else {
      st.controls.mouseButtons = {
        LEFT: null as unknown as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    }
  }, [activeTool, spacePressed]);

  // Smooth camera preset transitions
  useEffect(() => {
    const st = threeRef.current;
    if (!st || viewTrigger.nonce === 0) return;

    const tgt = new THREE.Vector3(0, 0.8, 0);
    let pos = new THREE.Vector3(9, 7, 11);

    if (viewTrigger.view === 'TOP') {
      pos = new THREE.Vector3(0, 16, 0.02);
    } else if (viewTrigger.view === 'FRONT') {
      pos = new THREE.Vector3(0, 1.5, 16);
    } else if (viewTrigger.view === 'SIDE') {
      pos = new THREE.Vector3(16, 1.5, 0);
    }

    st.cameraGoal = { pos, target: tgt };
    st.requestRender();
  }, [viewTrigger]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.code === 'Space') {
        setSpacePressed(true);
      } else if (e.key === 'Escape') {
        setLineDraftStart(null);
        setPolygonDraft([]);
        setDraggingEndpoint(null);
        setMovingDrag(null);
        setExtrudeDrag(null);
        setActiveAxis('NONE');
      } else if (e.key === 'Enter' && activeTool === 'surface' && polygonDraft.length >= 3) {
        onAddSurface(polygonDraft, surfaceFillMode);
        setPolygonDraft([]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activeTool, polygonDraft, surfaceFillMode, onAddSurface, setPolygonDraft]);

  // Reset active draft/drag state when switching projects or tools
  useEffect(() => {
    setLineDraftStart(null);
    setLineDraftDownPx(null);
    setDraggingEndpoint(null);
    setMovingDrag(null);
    setExtrudeDrag(null);
    setActiveAxis('NONE');
  }, [project.id, activeTool]);

  // Build clean 3D floor grid & colored X/Y/Z axes
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;

    const { gridGroup, requestRender } = st;
    while (gridGroup.children.length > 0) {
      const obj = gridGroup.children[0] as THREE.Mesh | THREE.Line | THREE.Sprite;
      if ('geometry' in obj && obj.geometry) obj.geometry.dispose();
      if ('material' in obj && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if ('map' in m && m.map) (m.map as THREE.Texture).dispose();
          m.dispose();
        });
      }
      gridGroup.remove(obj);
    }

    const floorGrid = new THREE.GridHelper(24, 24, 0xcbd5e1, 0xe2e8f0);
    floorGrid.position.y = -0.005;
    const mats = Array.isArray(floorGrid.material) ? floorGrid.material : [floorGrid.material];
    mats.forEach((m) => {
      m.transparent = true;
      m.opacity = Math.min(1, 0.4 + project.grid.lineWidth * 0.22);
    });
    gridGroup.add(floorGrid);

    if (project.grid.showAxes) {
      const axisLen = 7;
      const makeAxis = (end: THREE.Vector3, hex: number) => {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), end]);
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: hex }));
      };
      gridGroup.add(makeAxis(new THREE.Vector3(axisLen, 0, 0), 0xdc2626)); // X Rouge
      gridGroup.add(makeAxis(new THREE.Vector3(0, axisLen, 0), 0x2563eb)); // Y Bleu (Hauteur)
      gridGroup.add(makeAxis(new THREE.Vector3(0, 0, axisLen), 0x16a34a)); // Z Vert

      gridGroup.add(createAxisSprite('X', '#DC2626', new THREE.Vector3(axisLen + 0.55, 0, 0)));
      gridGroup.add(createAxisSprite('Y', '#2563EB', new THREE.Vector3(0, axisLen + 0.55, 0)));
      gridGroup.add(createAxisSprite('Z', '#16A34A', new THREE.Vector3(0, 0, axisLen + 0.55)));
    }

    if (project.grid.showOrigin) {
      const originDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0x0f172a })
      );
      gridGroup.add(originDot);
    }

    requestRender();
  }, [project.grid, createAxisSprite]);

  // Rebuild 3D Lines, Surfaces & Extruded Volumes
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;

    const { cadGroup, surfaceMeshesGroup, requestRender } = st;

    const clearGroup = (grp: THREE.Group) => {
      while (grp.children.length > 0) {
        const obj = grp.children[0] as THREE.Mesh | THREE.Line;
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
        grp.remove(obj);
      }
    };

    clearGroup(cadGroup);
    clearGroup(surfaceMeshesGroup);

    const makeFatLine = (
      p1: Point3D,
      p2: Point3D,
      colorHex: number,
      linewidth: number,
      depthTest = true,
      opacity = 1,
      renderOrder = 15
    ) => {
      if (distance3D(p1, p2) < 1e-4) return null;
      const geo = new LineGeometry();
      geo.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
      const mat = new LineMaterial({
        color: colorHex,
        linewidth,
        resolution: st.resolution.clone(),
        depthTest,
        transparent: !depthTest || opacity < 1,
        opacity,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const lineObj = new Line2(geo, mat);
      lineObj.computeLineDistances();
      lineObj.renderOrder = renderOrder;
      return lineObj;
    };

    // Lines
    project.lines.forEach((line) => {
      const isSelected = selectedLineIds.includes(line.id);
      const isHovered = line.id === hoveredLineId;

      const baseHex = line.color ? new THREE.Color(line.color).getHex() : 0x0f172a;
      const color = isHovered ? 0xf59e0b : baseHex;
      const lineObj = makeFatLine(
        line.start,
        line.end,
        color,
        isSelected ? 4.2 : isHovered ? 3.4 : 2.8,
        !isSelected && !isHovered && displayMode === 'solid',
        1,
        isSelected ? 40 : isHovered ? 35 : 18
      );
      if (lineObj) cadGroup.add(lineObj);

      if (isSelected || activeTool === 'edit_endpoints') {
        const hGeo = new THREE.SphereGeometry(0.13, 12, 12);
        const hMat = new THREE.MeshBasicMaterial({
          color: isSelected ? 0x2563eb : 0xf59e0b,
          depthTest: false,
        });
        [line.start, line.end].forEach((pt) => {
          const m = new THREE.Mesh(hGeo, hMat);
          m.position.set(pt.x, pt.y, pt.z);
          m.renderOrder = 45;
          cadGroup.add(m);
        });
      }
    });

    // Surfaces & Extruded 3D Solids
    project.surfaces.forEach((surf) => {
      if (surf.vertices.length < 3) return;
      const isSelected = surf.id === selectedSurfaceId;
      const isHovered = surf.id === hoveredSurfaceId;

      const surfGeo = buildSurfaceGeometry3D(surf);
      if (surfGeo) {
        if (displayMode === 'solid' && surf.filled) {
          const surfHex = surf.color ? new THREE.Color(surf.color).getHex() : 0xdbeafe;
          const mat = new THREE.MeshPhysicalMaterial({
            color: isHovered ? 0xfde68a : surfHex,
            roughness: 0.35,
            metalness: 0.08,
            transparent: Math.abs(surf.extrudeHeight || 0) < 0.01,
            opacity: Math.abs(surf.extrudeHeight || 0) < 0.01 ? 0.78 : 0.96,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          const mesh = new THREE.Mesh(surfGeo, mat);
          mesh.userData.surfaceId = surf.id;
          surfaceMeshesGroup.add(mesh);

          // Crisp architectural edge lines around the solid
          const edgesGeo = new THREE.EdgesGeometry(surfGeo, 15);
          const edgesMat = new THREE.LineBasicMaterial({
            color: isSelected ? 0x1d4ed8 : isHovered ? 0xd97706 : 0x1e293b,
          });
          cadGroup.add(new THREE.LineSegments(edgesGeo, edgesMat));
        } else {
          // Wireframe / Unfilled outline
          const edgesGeo = new THREE.EdgesGeometry(surfGeo, 15);
          const outlineHex = surf.color ? new THREE.Color(surf.color).getHex() : 0x334155;
          const edgesMat = new THREE.LineBasicMaterial({
            color: isSelected ? 0x2563eb : isHovered ? 0xf59e0b : outlineHex,
          });
          cadGroup.add(new THREE.LineSegments(edgesGeo, edgesMat));

          const proxyMat = new THREE.MeshBasicMaterial({
            visible: false,
            side: THREE.DoubleSide,
          });
          const proxyMesh = new THREE.Mesh(surfGeo, proxyMat);
          proxyMesh.userData.surfaceId = surf.id;
          surfaceMeshesGroup.add(proxyMesh);
        }
      }
    });

    requestRender();
  }, [
    project.lines,
    project.surfaces,
    selectedLineIds,
    selectedSurfaceId,
    hoveredLineId,
    hoveredSurfaceId,
    activeTool,
    displayMode,
  ]);

  // Rebuild Live 3D Preview (Cursor Dot, Axis-Colored Line Draft, Polygon Draft)
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;

    const { previewGroup, requestRender } = st;
    while (previewGroup.children.length > 0) {
      const obj = previewGroup.children[0] as THREE.Mesh | THREE.Line;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
      previewGroup.remove(obj);
    }

    const makePreviewLine = (
      pts: Point3D[],
      colorHex: number,
      linewidth: number,
      opacity = 1,
      renderOrder = 100
    ) => {
      const cleanPts: Point3D[] = [];
      pts.forEach((p) => {
        if (cleanPts.length === 0 || distance3D(cleanPts[cleanPts.length - 1], p) > 1e-4) {
          cleanPts.push(p);
        }
      });
      if (cleanPts.length < 2) return null;

      const flat: number[] = [];
      cleanPts.forEach((p) => flat.push(p.x, p.y, p.z));
      const geo = new LineGeometry();
      geo.setPositions(flat);
      const mat = new LineMaterial({
        color: colorHex,
        linewidth,
        resolution: st.resolution.clone(),
        depthTest: false,
        transparent: true,
        opacity,
      });
      const lineObj = new Line2(geo, mat);
      lineObj.computeLineDistances();
      lineObj.renderOrder = renderOrder;
      return lineObj;
    };

    const customLineHex = new THREE.Color(activeLineColor || '#0f172a').getHex();
    const customSurfaceHex = new THREE.Color(activeSurfaceColor || '#2563eb').getHex();

    if (activeTool !== 'orbit' && activeTool !== 'eraser' && activeTool !== 'extrude') {
      const dotColor = snappedVertex
        ? 0x16a34a
        : activeAxis === 'X'
        ? 0xdc2626
        : activeAxis === 'Y'
        ? 0x2563eb
        : activeAxis === 'Z'
        ? 0x16a34a
        : activeTool === 'surface'
        ? customSurfaceHex
        : customLineHex;

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(snappedVertex ? 0.15 : 0.11, 14, 14),
        new THREE.MeshBasicMaterial({ color: dotColor, depthTest: false })
      );
      dot.position.set(hoveredPt.x, hoveredPt.y, hoveredPt.z);
      dot.renderOrder = 110;
      previewGroup.add(dot);
    }

    if ((activeTool === 'line' || activeTool === 'angled_line') && lineDraftStart) {
      const lineColor =
        activeAxis === 'X'
          ? 0xdc2626
          : activeAxis === 'Y'
          ? 0x2563eb
          : activeAxis === 'Z'
          ? 0x16a34a
          : customLineHex;

      // Always draw continuous line all the way to the cursor (from pixel 1, never hidden behind faces)
      if (!pointsEqual3D(lineDraftStart, hoveredRawPt, 0.005)) {
        const isSnappedSameAsStart = pointsEqual3D(lineDraftStart, hoveredPt, 0.01);
        const liveLine = makePreviewLine(
          [lineDraftStart, hoveredRawPt],
          lineColor,
          isSnappedSameAsStart ? 3.2 : 2.2,
          isSnappedSameAsStart ? 0.95 : 0.55,
          98
        );
        if (liveLine) previewGroup.add(liveLine);
      }

      // Draw bold snapped segment when snapped point moves away from start
      if (!pointsEqual3D(lineDraftStart, hoveredPt, 0.01)) {
        const snappedLine = makePreviewLine([lineDraftStart, hoveredPt], lineColor, 3.6, 1, 102);
        if (snappedLine) previewGroup.add(snappedLine);
      }

      const startDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 12, 12),
        new THREE.MeshBasicMaterial({ color: lineColor, depthTest: false })
      );
      startDot.position.set(lineDraftStart.x, lineDraftStart.y, lineDraftStart.z);
      startDot.renderOrder = 110;
      previewGroup.add(startDot);
    }

    if (activeTool === 'surface' && polygonDraft.length > 0) {
      const pts = [...polygonDraft, hoveredRawPt];
      const polyLine = makePreviewLine(pts, customSurfaceHex, 3.2, 0.95, 100);
      if (polyLine) previewGroup.add(polyLine);

      polygonDraft.forEach((p, idx) => {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(idx === 0 ? 0.15 : 0.1, 12, 12),
          new THREE.MeshBasicMaterial({
            color: idx === 0 ? 0x0f172a : customSurfaceHex,
            depthTest: false,
          })
        );
        sphere.position.set(p.x, p.y, p.z);
        sphere.renderOrder = 110;
        previewGroup.add(sphere);
      });
    }

    requestRender();
  }, [
    hoveredPt,
    hoveredRawPt,
    snappedVertex,
    activeAxis,
    lineDraftStart,
    polygonDraft,
    activeTool,
    activeLineColor,
    activeSurfaceColor,
  ]);

  const projectWorldToScreen = useCallback((pt: Point3D): { x: number; y: number } | null => {
    const st = threeRef.current;
    const el = containerRef.current;
    if (!st || !el) return null;
    const rect = el.getBoundingClientRect();
    _vec3.set(pt.x, pt.y, pt.z).project(st.camera);
    if (_vec3.z > 1) return null;
    return {
      x: ((_vec3.x + 1) / 2) * rect.width,
      y: ((-_vec3.y + 1) / 2) * rect.height,
    };
  }, []);

  /**
   * SketchUp-style 3D Point Resolver:
   * 1. Snap to any existing 3D corner (<14px)
   * 2. If drawing from a start point, infer Red X, Blue Y (vertical!), or Green Z axis (<15px)
   * 3. Otherwise intersect horizontal plane at startPoint.y (or floor y=0) and snap to grid!
   */
  const resolvePoint3D = useCallback(
    (
      clientX: number,
      clientY: number,
      startPt?: Point3D | null,
      allowAxisInference = true
    ): { point: Point3D; rawPoint: Point3D; isVertex: boolean; axis: AxisInference } => {
      const st = threeRef.current;
      const el = containerRef.current;
      if (!st || !el) {
        const fallback = { x: 0, y: 0, z: 0 };
        return { point: fallback, rawPoint: fallback, isVertex: false, axis: 'NONE' };
      }

      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      // 1. Vertex Snap (works on lines, surfaces, and extruded volume corners!)
      let bestVertex: Point3D | null = null;
      let bestPxDist = 14;
      for (const v of allVertices) {
        const sp = projectWorldToScreen(v);
        if (!sp) continue;
        const d = Math.hypot(sp.x - px, sp.y - py);
        if (d < bestPxDist) {
          bestPxDist = d;
          bestVertex = v;
        }
      }
      if (bestVertex) {
        return { point: bestVertex, rawPoint: bestVertex, isVertex: true, axis: 'NONE' };
      }

      _mouseNDC.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
      _raycaster.setFromCamera(_mouseNDC, st.camera);

      const snapVal = (v: number) =>
        project.grid.snapToGrid ? Math.round(v) : Math.round(v * 10) / 10;

      // 2. Smart Axis Inference (Red X, Blue Y Vertical, Green Z) when drawing from startPt
      if (startPt && allowAxisInference && activeTool === 'line') {
        const sScreen = projectWorldToScreen(startPt);
        if (sScreen) {
          const candidates: { axis: AxisInference; dir: THREE.Vector3 }[] = [
            { axis: 'Y', dir: new THREE.Vector3(0, 1, 0) }, // Vertical Blue!
            { axis: 'X', dir: new THREE.Vector3(1, 0, 0) }, // Red X
            { axis: 'Z', dir: new THREE.Vector3(0, 0, 1) }, // Green Z
          ];

          let bestAxis: AxisInference = 'NONE';
          let bestScreenDist = 15;
          let bestDir = new THREE.Vector3();

          for (const c of candidates) {
            // Skip axis if ray is nearly parallel to it (prevents axis explosion in Top/Front/Side views)
            if (Math.abs(c.dir.dot(_raycaster.ray.direction)) > 0.9) continue;

            const plusPt = {
              x: startPt.x + c.dir.x * 2,
              y: startPt.y + c.dir.y * 2,
              z: startPt.z + c.dir.z * 2,
            };
            const pScreen = projectWorldToScreen(plusPt);
            if (!pScreen) continue;
            if (Math.hypot(pScreen.x - sScreen.x, pScreen.y - sScreen.y) < 12) continue;

            const d = distPointToInfiniteLine2D(
              px,
              py,
              sScreen.x,
              sScreen.y,
              pScreen.x,
              pScreen.y
            );
            if (d < bestScreenDist) {
              bestScreenDist = d;
              bestAxis = c.axis;
              bestDir = c.dir;
            }
          }

          if (bestAxis !== 'NONE') {
            const originVec = new THREE.Vector3(startPt.x, startPt.y, startPt.z);
            const tRaw = closestTOnAxisToRay(_raycaster.ray, originVec, bestDir);
            if (Math.abs(tRaw) <= 50) {
              const t = snapVal(tRaw);
              return {
                point: {
                  x: Math.round((startPt.x + bestDir.x * t) * 100) / 100,
                  y: Math.round((startPt.y + bestDir.y * t) * 100) / 100,
                  z: Math.round((startPt.z + bestDir.z * t) * 100) / 100,
                },
                rawPoint: {
                  x: startPt.x + bestDir.x * tRaw,
                  y: startPt.y + bestDir.y * tRaw,
                  z: startPt.z + bestDir.z * tRaw,
                },
                isVertex: false,
                axis: bestAxis,
              };
            }
          }
        }
      }

      // 3. Camera-aware working plane (horizontal by default; vertical facing camera in Front/Side or low angles)
      const camForward = new THREE.Vector3();
      st.camera.getWorldDirection(camForward);
      const anchor = startPt || { x: 0, y: 0, z: 0 };

      let planeMode: 'HORIZ' | 'XY' | 'YZ' = 'HORIZ';
      let workPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -anchor.y);

      if (Math.abs(camForward.y) < 0.28) {
        if (Math.abs(camForward.z) >= Math.abs(camForward.x)) {
          planeMode = 'XY';
          workPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -anchor.z);
        } else {
          planeMode = 'YZ';
          workPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -anchor.x);
        }
      }

      const hit = new THREE.Vector3();
      const intersected = _raycaster.ray.intersectPlane(workPlane, hit);

      if (!intersected || hit.distanceTo(new THREE.Vector3(anchor.x, anchor.y, anchor.z)) > 80) {
        return {
          point: anchor,
          rawPoint: anchor,
          isVertex: false,
          axis: 'NONE',
        };
      }

      // Apply angle lock for 'angled_line'
      if (activeTool === 'angled_line' && startPt) {
        const rad = (customAngleDeg * Math.PI) / 180;
        if (planeMode === 'XY') {
          const dx = hit.x - startPt.x;
          const dy = hit.y - startPt.y;
          const rawDist = Math.hypot(dx, dy);
          const sign = dx * Math.cos(rad) + dy * Math.sin(rad) < 0 ? -1 : 1;
          const distCells = project.grid.snapToGrid
            ? Math.max(1, Math.round(rawDist))
            : Math.max(0.5, rawDist);
          return {
            point: {
              x: Math.round((startPt.x + sign * distCells * Math.cos(rad)) * 100) / 100,
              y: Math.round((startPt.y + sign * distCells * Math.sin(rad)) * 100) / 100,
              z: startPt.z,
            },
            rawPoint: {
              x: startPt.x + sign * rawDist * Math.cos(rad),
              y: startPt.y + sign * rawDist * Math.sin(rad),
              z: startPt.z,
            },
            isVertex: false,
            axis: 'NONE',
          };
        }
        if (planeMode === 'YZ') {
          const dz = hit.z - startPt.z;
          const dy = hit.y - startPt.y;
          const rawDist = Math.hypot(dz, dy);
          const sign = dz * Math.cos(rad) + dy * Math.sin(rad) < 0 ? -1 : 1;
          const distCells = project.grid.snapToGrid
            ? Math.max(1, Math.round(rawDist))
            : Math.max(0.5, rawDist);
          return {
            point: {
              x: startPt.x,
              y: Math.round((startPt.y + sign * distCells * Math.sin(rad)) * 100) / 100,
              z: Math.round((startPt.z + sign * distCells * Math.cos(rad)) * 100) / 100,
            },
            rawPoint: {
              x: startPt.x,
              y: startPt.y + sign * rawDist * Math.sin(rad),
              z: startPt.z + sign * rawDist * Math.cos(rad),
            },
            isVertex: false,
            axis: 'NONE',
          };
        }

        const dx = hit.x - startPt.x;
        const dz = hit.z - startPt.z;
        const rawDist = Math.hypot(dx, dz);
        const dirDot = dx * Math.cos(rad) + dz * Math.sin(rad);
        const sign = dirDot < 0 ? -1 : 1;
        const distCells = project.grid.snapToGrid
          ? Math.max(1, Math.round(rawDist))
          : Math.max(0.5, rawDist);

        return {
          point: {
            x: Math.round((startPt.x + sign * distCells * Math.cos(rad)) * 100) / 100,
            y: startPt.y,
            z: Math.round((startPt.z + sign * distCells * Math.sin(rad)) * 100) / 100,
          },
          rawPoint: {
            x: startPt.x + sign * rawDist * Math.cos(rad),
            y: startPt.y,
            z: startPt.z + sign * rawDist * Math.sin(rad),
          },
          isVertex: false,
          axis: 'NONE',
        };
      }

      if (planeMode === 'XY') {
        return {
          point: { x: snapVal(hit.x), y: snapVal(hit.y), z: anchor.z },
          rawPoint: { x: hit.x, y: hit.y, z: anchor.z },
          isVertex: false,
          axis: 'NONE',
        };
      }
      if (planeMode === 'YZ') {
        return {
          point: { x: anchor.x, y: snapVal(hit.y), z: snapVal(hit.z) },
          rawPoint: { x: anchor.x, y: hit.y, z: hit.z },
          isVertex: false,
          axis: 'NONE',
        };
      }

      return {
        point: {
          x: snapVal(hit.x),
          y: anchor.y,
          z: snapVal(hit.z),
        },
        rawPoint: {
          x: hit.x,
          y: anchor.y,
          z: hit.z,
        },
        isVertex: false,
        axis: 'NONE',
      };
    },
    [
      allVertices,
      projectWorldToScreen,
      project.grid.snapToGrid,
      activeTool,
      customAngleDeg,
    ]
  );

  const hitTestLine = useCallback(
    (clientX: number, clientY: number): CADLine3D | null => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      let bestLine: CADLine3D | null = null;
      let bestDist = 11;
      for (const line of project.lines) {
        const s1 = projectWorldToScreen(line.start);
        const s2 = projectWorldToScreen(line.end);
        if (!s1 || !s2) continue;
        const d = distPointToSegment2D(px, py, s1.x, s1.y, s2.x, s2.y);
        if (d < bestDist) {
          bestDist = d;
          bestLine = line;
        }
      }
      return bestLine;
    },
    [project.lines, projectWorldToScreen]
  );

  const hitTestSurface = useCallback(
    (clientX: number, clientY: number): CADSurface3D | null => {
      const st = threeRef.current;
      const el = containerRef.current;
      if (!st || !el) return null;
      const rect = el.getBoundingClientRect();
      _mouseNDC.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      _raycaster.setFromCamera(_mouseNDC, st.camera);
      const hits = _raycaster.intersectObjects(st.surfaceMeshesGroup.children, false);
      if (hits.length > 0) {
        const sid = hits[0].object.userData.surfaceId as string;
        return project.surfaces.find((s) => s.id === sid) || null;
      }
      return null;
    },
    [project.surfaces]
  );

  const hitTestEndpoint = useCallback(
    (clientX: number, clientY: number): { lineId: string; which: 'start' | 'end'; pt: Point3D } | null => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      for (const line of project.lines) {
        const s1 = projectWorldToScreen(line.start);
        if (s1 && Math.hypot(s1.x - px, s1.y - py) < 13) {
          return { lineId: line.id, which: 'start', pt: line.start };
        }
        const s2 = projectWorldToScreen(line.end);
        if (s2 && Math.hypot(s2.x - px, s2.y - py) < 13) {
          return { lineId: line.id, which: 'end', pt: line.end };
        }
      }
      return null;
    },
    [project.lines, projectWorldToScreen]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || spacePressed || activeTool === 'orbit') return;

    const anchor =
      activeTool === 'line' || activeTool === 'angled_line'
        ? lineDraftStart
        : activeTool === 'surface' && polygonDraft.length > 0
        ? polygonDraft[0]
        : null;

    const { point, rawPoint } = resolvePoint3D(e.clientX, e.clientY, anchor);

    if (activeTool === 'line' || activeTool === 'angled_line') {
      if (!lineDraftStart) {
        setLineDraftStart(point);
        setLineDraftDownPx({ x: e.clientX, y: e.clientY });
        setHoveredPt(point);
        setHoveredRawPt(rawPoint);
      } else {
        if (!pointsEqual3D(lineDraftStart, point, 0.01)) {
          onAddLine(lineDraftStart, point);
          setLineDraftStart(null);
          setLineDraftDownPx(null);
          setActiveAxis('NONE');
        }
      }
      return;
    }

    if (activeTool === 'surface') {
      if (polygonDraft.length >= 3 && pointsEqual3D(point, polygonDraft[0], 0.15)) {
        onAddSurface(polygonDraft, surfaceFillMode);
        setPolygonDraft([]);
        return;
      }
      if (
        polygonDraft.length > 0 &&
        pointsEqual3D(point, polygonDraft[polygonDraft.length - 1], 0.05)
      ) {
        return;
      }
      setPolygonDraft((prev) => [...prev, point]);
      return;
    }

    if (activeTool === 'extrude') {
      const surfHit = hitTestSurface(e.clientX, e.clientY);
      if (surfHit) {
        onPushHistory();
        onSelectSurface(surfHit.id);
        onSelectLines([]);
        setExtrudeDrag({
          surfaceId: surfHit.id,
          startYpx: e.clientY,
          origHeight: surfHit.extrudeHeight || 0,
        });
      } else {
        onNotify('Cliquez sur une surface remplie et glissez vers le haut pour l’extruder en 3D.', 'info');
      }
      return;
    }

    if (activeTool === 'edit_endpoints') {
      const ep = hitTestEndpoint(e.clientX, e.clientY);
      if (ep) {
        onPushHistory();
        setDraggingEndpoint({ lineId: ep.lineId, which: ep.which, anchorPt: ep.pt });
        onSelectLines([ep.lineId]);
      }
      return;
    }

    if (activeTool === 'eraser') {
      const lineHit = hitTestLine(e.clientX, e.clientY);
      if (lineHit) {
        onDeleteItem(lineHit.id, undefined);
        return;
      }
      const surfHit = hitTestSurface(e.clientX, e.clientY);
      if (surfHit) {
        onDeleteItem(undefined, surfHit.id);
      }
      return;
    }

    if (activeTool === 'move') {
      const lineHit = hitTestLine(e.clientX, e.clientY);
      const surfHit = !lineHit ? hitTestSurface(e.clientX, e.clientY) : null;

      if (lineHit) {
        onPushHistory();
        if (!selectedLineIds.includes(lineHit.id)) {
          onSelectLines([lineHit.id]);
          onSelectSurface(null);
        }
        const startRes = resolvePoint3D(e.clientX, e.clientY, lineHit.start, false);
        setMovingDrag({
          lastPt: startRes.point,
          anchorPt: lineHit.start,
          targetLineId: lineHit.id,
        });
      } else if (surfHit) {
        onPushHistory();
        onSelectSurface(surfHit.id);
        onSelectLines([]);
        const startRes = resolvePoint3D(e.clientX, e.clientY, surfHit.vertices[0], false);
        setMovingDrag({
          lastPt: startRes.point,
          anchorPt: surfHit.vertices[0],
          targetSurfId: surfHit.id,
        });
      }
      return;
    }

    if (activeTool === 'select') {
      const ep = hitTestEndpoint(e.clientX, e.clientY);
      if (ep && selectedLineIds.includes(ep.lineId)) {
        onPushHistory();
        setDraggingEndpoint({ lineId: ep.lineId, which: ep.which, anchorPt: ep.pt });
        return;
      }

      const lineHit = hitTestLine(e.clientX, e.clientY);
      if (lineHit) {
        onSelectSurface(null);
        if (e.shiftKey) {
          if (selectedLineIds.includes(lineHit.id)) {
            onSelectLines(selectedLineIds.filter((id) => id !== lineHit.id));
          } else {
            onSelectLines([...selectedLineIds, lineHit.id]);
          }
        } else {
          onSelectLines([lineHit.id]);
        }
        return;
      }

      const surfHit = hitTestSurface(e.clientX, e.clientY);
      if (surfHit) {
        onSelectLines([]);
        onSelectSurface(surfHit.id);
        return;
      }

      onSelectLines([]);
      onSelectSurface(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (extrudeDrag) {
      const dy = extrudeDrag.startYpx - e.clientY;
      const deltaUnits = dy / 35;
      const nextH = project.grid.snapToGrid
        ? Math.round(extrudeDrag.origHeight + deltaUnits)
        : Math.round((extrudeDrag.origHeight + deltaUnits) * 10) / 10;
      onUpdateSurface(
        extrudeDrag.surfaceId,
        {
          filled: true,
          extrudeHeight: nextH,
        },
        true
      );
      return;
    }

    if (draggingEndpoint) {
      const targetLine = project.lines.find((l) => l.id === draggingEndpoint.lineId);
      if (targetLine) {
        const { point, axis } = resolvePoint3D(e.clientX, e.clientY, draggingEndpoint.anchorPt);
        setActiveAxis(axis);
        if (draggingEndpoint.which === 'start') {
          if (!pointsEqual3D(point, targetLine.end, 0.01)) {
            onUpdateLineEndpoints(targetLine.id, point, targetLine.end, true);
          }
        } else {
          if (!pointsEqual3D(point, targetLine.start, 0.01)) {
            onUpdateLineEndpoints(targetLine.id, targetLine.start, point, true);
          }
        }
        setHoveredPt(point);
      }
      return;
    }

    if (movingDrag) {
      const { point } = resolvePoint3D(e.clientX, e.clientY, movingDrag.anchorPt, false);
      const dx = point.x - movingDrag.lastPt.x;
      const dy = point.y - movingDrag.lastPt.y;
      const dz = point.z - movingDrag.lastPt.z;
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5 || Math.abs(dz) >= 0.5) {
        onMoveSelection(
          { x: dx, y: dy, z: dz },
          movingDrag.targetLineId,
          movingDrag.targetSurfId,
          true
        );
        setMovingDrag({ ...movingDrag, lastPt: point });
      }
      return;
    }

    const anchor =
      activeTool === 'line' || activeTool === 'angled_line'
        ? lineDraftStart
        : activeTool === 'surface' && polygonDraft.length > 0
        ? polygonDraft[0]
        : null;

    const { point, rawPoint, isVertex, axis } = resolvePoint3D(e.clientX, e.clientY, anchor);
    setHoveredPt(point);
    setHoveredRawPt(rawPoint);
    setSnappedVertex(isVertex);
    setActiveAxis(axis);

    if (
      activeTool === 'select' ||
      activeTool === 'eraser' ||
      activeTool === 'move' ||
      activeTool === 'extrude'
    ) {
      const hl = activeTool === 'extrude' ? null : hitTestLine(e.clientX, e.clientY);
      setHoveredLineId(hl ? hl.id : null);
      const hs = !hl ? hitTestSurface(e.clientX, e.clientY) : null;
      setHoveredSurfaceId(hs ? hs.id : null);
    } else {
      setHoveredLineId(null);
      setHoveredSurfaceId(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (extrudeDrag) {
      setExtrudeDrag(null);
      return;
    }
    if (draggingEndpoint) {
      setDraggingEndpoint(null);
      return;
    }
    if (movingDrag) {
      setMovingDrag(null);
      return;
    }
    if ((activeTool === 'line' || activeTool === 'angled_line') && lineDraftStart && lineDraftDownPx) {
      const movePx = Math.hypot(e.clientX - lineDraftDownPx.x, e.clientY - lineDraftDownPx.y);
      if (movePx > 14) {
        const { point } = resolvePoint3D(e.clientX, e.clientY, lineDraftStart);
        if (!pointsEqual3D(lineDraftStart, point, 0.01)) {
          onAddLine(lineDraftStart, point);
          setLineDraftStart(null);
          setLineDraftDownPx(null);
          setActiveAxis('NONE');
        }
      }
    }
  };

  const adjustCameraZoom = (factor: number) => {
    const st = threeRef.current;
    if (!st) return;
    const dir = st.camera.position.clone().sub(st.controls.target);
    dir.multiplyScalar(factor);
    if (dir.length() >= 2 && dir.length() <= 120) {
      st.camera.position.copy(st.controls.target).add(dir);
      st.controls.update();
      st.requestRender();
    }
  };

  const recenterCamera = () => {
    const st = threeRef.current;
    if (!st) return;
    st.cameraGoal = {
      pos: new THREE.Vector3(9, 7, 11),
      target: new THREE.Vector3(0, 0.8, 0),
    };
    st.requestRender();
  };

  // Floating 3D measurements
  const measurementBadges = useMemo(() => {
    void labelVersion;
    const badges: { id: string; text: string; x: number; y: number; active: boolean }[] = [];

    if ((activeTool === 'line' || activeTool === 'angled_line') && lineDraftStart) {
      const targetPt = pointsEqual3D(lineDraftStart, hoveredPt, 0.01) ? hoveredRawPt : hoveredPt;
      const mid = {
        x: (lineDraftStart.x + targetPt.x) / 2,
        y: (lineDraftStart.y + targetPt.y) / 2,
        z: (lineDraftStart.z + targetPt.z) / 2,
      };
      const sp = projectWorldToScreen(mid);
      const len = distance3D(lineDraftStart, targetPt) * project.grid.cellSize;
      if (sp && len > 0.05) {
        const axisTag =
          activeAxis === 'Y'
            ? ' · Hauteur Y'
            : activeAxis === 'X'
            ? ' · Axe X'
            : activeAxis === 'Z'
            ? ' · Axe Z'
            : '';
        badges.push({
          id: 'draft',
          text: `${len.toFixed(len % 1 === 0 ? 0 : 1)} ${project.grid.unit}${axisTag}`,
          x: sp.x,
          y: sp.y,
          active: true,
        });
      }
    }

    project.lines.forEach((line) => {
      const isSelected = selectedLineIds.includes(line.id);
      if (!isSelected && !project.grid.showMeasurements) return;
      const mid = {
        x: (line.start.x + line.end.x) / 2,
        y: (line.start.y + line.end.y) / 2,
        z: (line.start.z + line.end.z) / 2,
      };
      const sp = projectWorldToScreen(mid);
      if (!sp) return;
      const len = getLineRealLength3D(line, project.grid.cellSize);
      badges.push({
        id: line.id,
        text: `${len.toFixed(len % 1 === 0 ? 0 : 1)} ${project.grid.unit}`,
        x: sp.x,
        y: sp.y,
        active: isSelected,
      });
    });

    if (extrudeDrag) {
      const surf = project.surfaces.find((s) => s.id === extrudeDrag.surfaceId);
      if (surf && surf.vertices.length > 0) {
        const n = getOrientedExtrudeNormal(surf.vertices);
        const h = surf.extrudeHeight || 0;
        const cx =
          surf.vertices.reduce((acc, v) => acc + v.x, 0) / surf.vertices.length + n.x * h;
        const cy =
          surf.vertices.reduce((acc, v) => acc + v.y, 0) / surf.vertices.length + n.y * h;
        const cz =
          surf.vertices.reduce((acc, v) => acc + v.z, 0) / surf.vertices.length + n.z * h;
        const sp = projectWorldToScreen({ x: cx, y: cy, z: cz });
        if (sp) {
          const realH = Math.abs(h) * project.grid.cellSize;
          badges.push({
            id: 'extrude',
            text: `Hauteur : ${realH.toFixed(realH % 1 === 0 ? 0 : 1)} ${project.grid.unit}`,
            x: sp.x,
            y: sp.y - 16,
            active: true,
          });
        }
      }
    }

    return badges;
  }, [
    labelVersion,
    activeTool,
    lineDraftStart,
    hoveredPt,
    hoveredRawPt,
    activeAxis,
    extrudeDrag,
    project.lines,
    project.surfaces,
    project.grid.cellSize,
    project.grid.unit,
    project.grid.showMeasurements,
    selectedLineIds,
    projectWorldToScreen,
  ]);

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setExtrudeDrag(null);
        setDraggingEndpoint(null);
        setMovingDrag(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex-1 h-full bg-slate-50 overflow-hidden select-none ${
        activeTool === 'orbit' || spacePressed
          ? 'cursor-grab active:cursor-grabbing'
          : activeTool === 'eraser'
          ? 'cursor-pointer'
          : activeTool === 'move'
          ? 'cursor-move'
          : activeTool === 'extrude'
          ? 'cursor-ns-resize'
          : 'cursor-crosshair'
      }`}
    >
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Top-Left Beginner Tip */}
      <div className="absolute top-3 left-3 z-10 bg-white/95 border border-slate-200 rounded-lg px-3 py-1.5 shadow-xs text-xs text-slate-600 pointer-events-none">
        {TOOL_HINTS[activeTool]}
      </div>

      {/* Surface Polygon Finish Bar */}
      {activeTool === 'surface' && polygonDraft.length > 0 && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-12 left-3 z-10 bg-slate-900 text-white rounded-lg px-3.5 py-2 shadow-md flex items-center gap-3 text-xs"
        >
          <span>{polygonDraft.length} points placés</span>
          {polygonDraft.length >= 3 && (
            <button
              type="button"
              onClick={() => {
                onAddSurface(polygonDraft, surfaceFillMode);
                setPolygonDraft([]);
              }}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
            >
              Valider la surface
            </button>
          )}
          <button
            type="button"
            onClick={() => setPolygonDraft([])}
            className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
          >
            Annuler
          </button>
        </div>
      )}

      {/* Floating 3D Measurement Badges */}
      {measurementBadges.map((b) => (
        <div
          key={b.id}
          style={{ left: b.x, top: b.y }}
          className={`absolute -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none px-2 py-0.5 rounded text-[11px] font-mono font-semibold shadow-xs ${
            b.active
              ? 'bg-slate-900 text-white'
              : 'bg-white/95 text-slate-800 border border-slate-300'
          }`}
        >
          {b.text}
        </div>
      ))}

      {/* Bottom-Left Zoom & Live 3D Coordinates */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-20 left-4 z-10 flex items-center gap-2"
      >
        <div className="bg-white border border-slate-200 rounded-lg p-1 shadow-xs flex items-center gap-1">
          <button
            type="button"
            onClick={() => adjustCameraZoom(1.22)}
            className="w-7 h-7 text-xs font-mono font-bold text-slate-700 hover:bg-slate-100 rounded"
            title="Dézoomer"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => adjustCameraZoom(0.82)}
            className="w-7 h-7 text-xs font-mono font-bold text-slate-700 hover:bg-slate-100 rounded"
            title="Zoomer"
          >
            +
          </button>
          <button
            type="button"
            onClick={recenterCamera}
            className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
          >
            Recentrer
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-xs text-xs font-mono text-slate-600 flex items-center gap-2">
          <span>
            <strong className="text-red-600">X:</strong> {hoveredPt.x * project.grid.cellSize}
          </span>
          <span>
            <strong className="text-blue-600">Y:</strong> {hoveredPt.y * project.grid.cellSize}
          </span>
          <span>
            <strong className="text-green-600">Z:</strong> {hoveredPt.z * project.grid.cellSize}
          </span>
          <span className="text-slate-400">{project.grid.unit}</span>
        </div>
      </div>
    </div>
  );
};

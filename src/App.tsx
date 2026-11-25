/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Box,
  CheckCircle2,
  FolderOpen,
  Grid,
  Info,
  Pentagon,
  Ruler,
  Trash2,
} from 'lucide-react';
import { Canvas3D } from './components/Canvas3D';
import { DrawingToolbar } from './components/DrawingToolbar';
import { ExportModal } from './components/ExportModal';
import { ProjectModal } from './components/ProjectModal';
import {
  CADLine3D,
  CADProject,
  CADSurface3D,
  CameraViewId,
  DisplayMode3D,
  GridSettings,
  Point3D,
  ToolId,
  UnitType,
} from './types/cad';
import {
  extractClosedLoopFromLines3D,
  getLineRealLength3D,
  getPolygonRealArea3D,
} from './utils/geometry3d';
import { createStarterProject } from './utils/templates';

const STORAGE_ACTIVE_KEY = 'xyz_studio_3d_app_active_v1';
const STORAGE_LIST_KEY = 'xyz_studio_3d_app_list_v1';

interface HistorySnapshot {
  lines: CADLine3D[];
  surfaces: CADSurface3D[];
}

export default function App() {
  const [project, setProject] = useState<CADProject>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_ACTIVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && Array.isArray(parsed.lines)) {
          return parsed;
        }
      }
    } catch {
      // Fallback
    }
    return createStarterProject();
  });

  const [savedProjects, setSavedProjects] = useState<CADProject[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_LIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback
    }
    return [createStarterProject()];
  });

  const [activeTool, setActiveTool] = useState<ToolId>('line');
  const [displayMode, setDisplayMode] = useState<DisplayMode3D>('solid');
  const [viewTrigger, setViewTrigger] = useState<{ view: CameraViewId; nonce: number }>({
    view: '3D',
    nonce: 0,
  });

  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null);

  const [customAngleDeg, setCustomAngleDeg] = useState<number>(45);
  const [surfaceFillMode, setSurfaceFillMode] = useState<boolean>(true);
  const [polygonDraft, setPolygonDraft] = useState<Point3D[]>([]);

  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);

  const [isProjectModalOpen, setIsProjectModalOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isGridMenuOpen, setIsGridMenuOpen] = useState<boolean>(false);

  const [notification, setNotification] = useState<{
    message: string;
    type: 'info' | 'error' | 'success';
  } | null>(null);

  const snapshot3DGetterRef = useRef<() => HTMLCanvasElement | string | null>(() => null);
  const handleRegisterSnapshotGetter = useCallback(
    (getter: () => HTMLCanvasElement | string | null) => {
      snapshot3DGetterRef.current = getter;
    },
    []
  );
  const projectRef = useRef<CADProject>(project);
  projectRef.current = project;

  const notify = useCallback(
    (message: string, type: 'info' | 'error' | 'success' = 'info') => {
      setNotification({ message, type });
    },
    []
  );

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ACTIVE_KEY, JSON.stringify(project));
      setSavedProjects((prev) => {
        const exists = prev.some((p) => p.id === project.id);
        const nextList = exists
          ? prev.map((p) => (p.id === project.id ? project : p))
          : [project, ...prev];
        localStorage.setItem(STORAGE_LIST_KEY, JSON.stringify(nextList));
        return nextList;
      });
    } catch {
      // Ignore
    }
  }, [project]);

  const pushHistorySnapshot = useCallback(() => {
    const snap = projectRef.current;
    setPast((h) => [...h.slice(-39), { lines: snap.lines, surfaces: snap.surfaces }]);
    setFuture([]);
  }, []);

  const commitGeometryChange = useCallback(
    (
      updater: (prev: CADProject) => { lines: CADLine3D[]; surfaces: CADSurface3D[] },
      skipHistory = false
    ) => {
      if (!skipHistory) {
        const snap = projectRef.current;
        setPast((h) => [...h.slice(-39), { lines: snap.lines, surfaces: snap.surfaces }]);
        setFuture([]);
      }
      setProject((prev) => {
        const nextGeo = updater(prev);
        return {
          ...prev,
          lines: nextGeo.lines,
          surfaces: nextGeo.surfaces,
          updatedAt: Date.now(),
        };
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [{ lines: project.lines, surfaces: project.surfaces }, ...f]);
    setProject((prev) => ({
      ...prev,
      lines: previous.lines,
      surfaces: previous.surfaces,
      updatedAt: Date.now(),
    }));
    setSelectedLineIds([]);
    setSelectedSurfaceId(null);
  }, [past, project.lines, project.surfaces]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, { lines: project.lines, surfaces: project.surfaces }]);
    setProject((prev) => ({
      ...prev,
      lines: next.lines,
      surfaces: next.surfaces,
      updatedAt: Date.now(),
    }));
    setSelectedLineIds([]);
    setSelectedSurfaceId(null);
  }, [future, project.lines, project.surfaces]);

  const handleAddLine = useCallback(
    (start: Point3D, end: Point3D) => {
      const newLine: CADLine3D = {
        id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        start,
        end,
        createdAt: Date.now(),
      };
      commitGeometryChange((prev) => ({
        lines: [...prev.lines, newLine],
        surfaces: prev.surfaces,
      }));
      setSelectedLineIds([newLine.id]);
      setSelectedSurfaceId(null);
    },
    [commitGeometryChange]
  );

  const handleUpdateLineEndpoints = useCallback(
    (lineId: string, start: Point3D, end: Point3D, skipHistory = false) => {
      commitGeometryChange(
        (prev) => ({
          lines: prev.lines.map((l) => (l.id === lineId ? { ...l, start, end } : l)),
          surfaces: prev.surfaces,
        }),
        skipHistory
      );
    },
    [commitGeometryChange]
  );

  const handleMoveSelection = useCallback(
    (delta: Point3D, targetLineId?: string, targetSurfId?: string, skipHistory = false) => {
      const lineIdsToMove = targetLineId ? [targetLineId] : selectedLineIds;
      const surfIdToMove = targetSurfId || selectedSurfaceId;

      commitGeometryChange(
        (prev) => ({
          lines: prev.lines.map((l) => {
            if (lineIdsToMove.includes(l.id)) {
              return {
                ...l,
                start: { x: l.start.x + delta.x, y: l.start.y + delta.y, z: l.start.z + delta.z },
                end: { x: l.end.x + delta.x, y: l.end.y + delta.y, z: l.end.z + delta.z },
              };
            }
            return l;
          }),
          surfaces: prev.surfaces.map((s) => {
            if (s.id === surfIdToMove) {
              return {
                ...s,
                vertices: s.vertices.map((v) => ({
                  x: v.x + delta.x,
                  y: v.y + delta.y,
                  z: v.z + delta.z,
                })),
              };
            }
            return s;
          }),
        }),
        skipHistory
      );
    },
    [selectedLineIds, selectedSurfaceId, commitGeometryChange]
  );

  const handleAddSurface = useCallback(
    (vertices: Point3D[], filled: boolean) => {
      if (vertices.length < 3) {
        notify('Une surface doit avoir au moins 3 points.', 'error');
        return;
      }
      const newSurf: CADSurface3D = {
        id: `surf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        vertices,
        filled,
        extrudeHeight: 0,
        createdAt: Date.now(),
      };
      commitGeometryChange((prev) => ({
        lines: prev.lines,
        surfaces: [...prev.surfaces, newSurf],
      }));
      setSelectedSurfaceId(newSurf.id);
      setSelectedLineIds([]);
      notify('Surface 3D créée.', 'success');
    },
    [commitGeometryChange, notify]
  );

  const handleCreateSurfaceFromSelectedLines = useCallback(() => {
    const selectedLines = project.lines.filter((l) => selectedLineIds.includes(l.id));
    const loopRes = extractClosedLoopFromLines3D(selectedLines);
    if (!loopRes.valid || !loopRes.vertices) {
      notify(loopRes.error || 'Les lignes sélectionnées ne forment pas une boucle fermée.', 'error');
      return;
    }
    const newSurf: CADSurface3D = {
      id: `surf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      vertices: loopRes.vertices,
      filled: surfaceFillMode,
      extrudeHeight: 0,
      createdAt: Date.now(),
    };
    commitGeometryChange((prev) => ({
      lines: prev.lines,
      surfaces: [...prev.surfaces, newSurf],
    }));
    setSelectedSurfaceId(newSurf.id);
    setSelectedLineIds([]);
    notify('Surface 3D créée depuis les lignes.', 'success');
  }, [project.lines, selectedLineIds, surfaceFillMode, commitGeometryChange, notify]);

  const handleUpdateSurface = useCallback(
    (surfaceId: string, patch: Partial<CADSurface3D>, skipHistory = false) => {
      commitGeometryChange(
        (prev) => ({
          lines: prev.lines,
          surfaces: prev.surfaces.map((s) => (s.id === surfaceId ? { ...s, ...patch } : s)),
        }),
        skipHistory
      );
    },
    [commitGeometryChange]
  );

  const handleDeleteItem = useCallback(
    (lineId?: string, surfaceId?: string) => {
      commitGeometryChange((prev) => ({
        lines: lineId ? prev.lines.filter((l) => l.id !== lineId) : prev.lines,
        surfaces: surfaceId ? prev.surfaces.filter((s) => s.id !== surfaceId) : prev.surfaces,
      }));
      if (lineId) setSelectedLineIds((ids) => ids.filter((id) => id !== lineId));
      if (surfaceId && selectedSurfaceId === surfaceId) setSelectedSurfaceId(null);
    },
    [commitGeometryChange, selectedSurfaceId]
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedLineIds.length === 0 && !selectedSurfaceId) return;
    commitGeometryChange((prev) => ({
      lines: prev.lines.filter((l) => !selectedLineIds.includes(l.id)),
      surfaces: prev.surfaces.filter((s) => s.id !== selectedSurfaceId),
    }));
    setSelectedLineIds([]);
    setSelectedSurfaceId(null);
  }, [selectedLineIds, selectedSurfaceId, commitGeometryChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleDeleteSelected]);

  const handleUpdateGrid = (patch: Partial<GridSettings>) => {
    setProject((prev) => ({
      ...prev,
      grid: { ...prev.grid, ...patch },
      updatedAt: Date.now(),
    }));
  };

  const selectedLines = project.lines.filter((l) => selectedLineIds.includes(l.id));
  const singleSelectedLine = selectedLines.length === 1 ? selectedLines[0] : null;
  const selectedSurface = project.surfaces.find((s) => s.id === selectedSurfaceId) || null;

  const hasContextualBar =
    Boolean(singleSelectedLine) ||
    selectedLines.length > 1 ||
    Boolean(selectedSurface) ||
    activeTool === 'angled_line' ||
    activeTool === 'surface';

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden">
      {/* Clean Single Top Bar */}
      <header className="relative flex items-center justify-between gap-4 px-5 py-2.5 bg-white border-b border-slate-200 shrink-0">
        {/* Left: App Name & Project Button */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            XYZ Studio 3D
          </span>
          <span className="text-slate-300">/</span>
          <button
            type="button"
            onClick={() => setIsProjectModalOpen(true)}
            className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
            <span>{project.name}</span>
          </button>
        </div>

        {/* Center: Simple Camera Orientation Controls */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          {(
            [
              { id: '3D', label: 'Vue 3D' },
              { id: 'TOP', label: 'Haut' },
              { id: 'FRONT', label: 'Face' },
              { id: 'SIDE', label: 'Côté' },
            ] as { id: CameraViewId; label: string }[]
          ).map((v) => {
            const isActive = viewTrigger.view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setViewTrigger((prev) => ({ view: v.id, nonce: prev.nonce + 1 }))}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        {/* Right: Filaire/Solide + Grid + Export */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setDisplayMode('wireframe')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                displayMode === 'wireframe'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Filaire
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('solid')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                displayMode === 'solid'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Solide
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsGridMenuOpen((v) => !v)}
            className={`px-3 py-1.5 border rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              isGridMenuOpen
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Grille ({project.grid.unit})</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExportModalOpen(true)}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Exporter
          </button>
        </div>

        {/* Grid Popover */}
        {isGridMenuOpen && (
          <div className="absolute right-5 top-14 z-40 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-4 space-y-3 text-xs">
            <div className="font-bold text-slate-900">Grille & Unités</div>

            <div className="flex items-center justify-between">
              <span className="text-slate-600">Unité</span>
              <select
                value={project.grid.unit}
                onChange={(e) => handleUpdateGrid({ unit: e.target.value as UnitType })}
                className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-medium"
              >
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-600">Taille d’une case ({project.grid.unit})</span>
              <input
                type="number"
                min="0.1"
                step="1"
                value={project.grid.cellSize}
                onChange={(e) =>
                  handleUpdateGrid({ cellSize: Math.max(0.1, Number(e.target.value) || 1) })
                }
                className="w-20 px-2 py-1 text-right font-mono border border-slate-300 rounded"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-slate-600 mb-1">
                <span>Visibilité de la grille</span>
                <span className="font-mono">{project.grid.lineWidth} px</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.25"
                value={project.grid.lineWidth}
                onChange={(e) => handleUpdateGrid({ lineWidth: Number(e.target.value) })}
                className="w-full accent-slate-900"
              />
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-700">Afficher les axes X, Y, Z</span>
              <input
                type="checkbox"
                checked={project.grid.showAxes}
                onChange={(e) => handleUpdateGrid({ showAxes: e.target.checked })}
                className="rounded border-slate-300 text-slate-900"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-700">Afficher l’origine (0,0,0)</span>
              <input
                type="checkbox"
                checked={project.grid.showOrigin}
                onChange={(e) => handleUpdateGrid({ showOrigin: e.target.checked })}
                className="rounded border-slate-300 text-slate-900"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-700">Aimant sur les cases</span>
              <input
                type="checkbox"
                checked={project.grid.snapToGrid}
                onChange={(e) => handleUpdateGrid({ snapToGrid: e.target.checked })}
                className="rounded border-slate-300 text-slate-900"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-slate-700">Toutes les mesures visibles</span>
              <input
                type="checkbox"
                checked={project.grid.showMeasurements}
                onChange={(e) => handleUpdateGrid({ showMeasurements: e.target.checked })}
                className="rounded border-slate-300 text-slate-900"
              />
            </label>
          </div>
        )}
      </header>

      {/* Contextual Strip (only appears when needed) */}
      {hasContextualBar && (
        <div className="flex items-center justify-center gap-4 px-4 py-1.5 bg-slate-100 border-b border-slate-200 text-xs shrink-0">
          {singleSelectedLine && (
            <div className="flex items-center gap-3">
              <Ruler className="w-3.5 h-3.5 text-slate-600" />
              <span>
                Longueur :{' '}
                <strong className="font-mono">
                  {getLineRealLength3D(singleSelectedLine, project.grid.cellSize).toFixed(1)}{' '}
                  {project.grid.unit}
                </strong>
              </span>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="text-red-600 hover:bg-red-50 px-2 py-0.5 rounded flex items-center gap-1 font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            </div>
          )}

          {selectedLines.length > 1 && (
            <div className="flex items-center gap-3">
              <span className="font-medium">{selectedLines.length} lignes sélectionnées</span>
              <button
                type="button"
                onClick={handleCreateSurfaceFromSelectedLines}
                className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-md flex items-center gap-1.5"
              >
                <Pentagon className="w-3.5 h-3.5" />
                Créer une surface
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="text-red-600 hover:bg-red-50 px-2 py-0.5 rounded"
              >
                Supprimer
              </button>
            </div>
          )}

          {selectedSurface && (
            <div className="flex items-center gap-4">
              <span className="font-medium">
                Surface :{' '}
                {getPolygonRealArea3D(selectedSurface.vertices, project.grid.cellSize).toFixed(1)}{' '}
                {project.grid.unit}²
              </span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSurface.filled}
                  onChange={(e) =>
                    handleUpdateSurface(selectedSurface.id, { filled: e.target.checked })
                  }
                  className="rounded border-slate-300 text-slate-900"
                />
                <span>Remplir</span>
              </label>
              <div className="flex items-center gap-1.5">
                <Box className="w-3.5 h-3.5 text-slate-600" />
                <span>Hauteur 3D :</span>
                <input
                  type="number"
                  step="1"
                  value={selectedSurface.extrudeHeight || 0}
                  onChange={(e) =>
                    handleUpdateSurface(selectedSurface.id, {
                      filled: true,
                      extrudeHeight: Number(e.target.value),
                    })
                  }
                  className="w-16 px-2 py-0.5 text-xs font-mono bg-white border border-slate-300 rounded text-center"
                />
                <span className="text-slate-500">cases</span>
              </div>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="text-red-600 hover:bg-red-50 px-2 py-0.5 rounded flex items-center gap-1 font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            </div>
          )}

          {activeTool === 'angled_line' &&
            !singleSelectedLine &&
            selectedLines.length === 0 &&
            !selectedSurface && (
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700">Angle :</span>
                <input
                  type="number"
                  step="5"
                  value={customAngleDeg}
                  onChange={(e) => setCustomAngleDeg(Number(e.target.value))}
                  className="w-16 px-2 py-0.5 text-xs font-mono bg-white border border-slate-300 rounded"
                />
                <span className="text-slate-500">°</span>
                {[30, 45, 60, 90].map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => setCustomAngleDeg(deg)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded ${
                      customAngleDeg === deg
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            )}

          {activeTool === 'surface' &&
            !singleSelectedLine &&
            selectedLines.length === 0 &&
            !selectedSurface && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={surfaceFillMode}
                    onChange={(e) => setSurfaceFillMode(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900"
                  />
                  <span className="font-medium">Surface remplie</span>
                </label>
                <span className="text-slate-300">|</span>
                <span className="text-slate-600">
                  Vous pouvez aussi sélectionner des lignes fermées (Maj+clic) pour fermer une face.
                </span>
              </div>
            )}
        </div>
      )}

      {notification && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg border flex items-center gap-2 text-xs font-medium ${
            notification.type === 'error'
              ? 'bg-red-950 text-white border-red-800'
              : 'bg-slate-900 text-white border-slate-700'
          }`}
        >
          {notification.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          ) : notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-blue-400 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Full-Viewport 3D Canvas */}
      <main
        className="flex-1 flex min-h-0 relative overflow-hidden"
        onPointerDown={() => {
          if (isGridMenuOpen) setIsGridMenuOpen(false);
        }}
      >
        <Canvas3D
          project={project}
          activeTool={activeTool}
          displayMode={displayMode}
          viewTrigger={viewTrigger}
          selectedLineIds={selectedLineIds}
          selectedSurfaceId={selectedSurfaceId}
          onSelectLines={setSelectedLineIds}
          onSelectSurface={setSelectedSurfaceId}
          onAddLine={handleAddLine}
          onUpdateLineEndpoints={handleUpdateLineEndpoints}
          onMoveSelection={handleMoveSelection}
          onAddSurface={handleAddSurface}
          onUpdateSurface={handleUpdateSurface}
          onDeleteItem={handleDeleteItem}
          onPushHistory={pushHistorySnapshot}
          customAngleDeg={customAngleDeg}
          surfaceFillMode={surfaceFillMode}
          polygonDraft={polygonDraft}
          setPolygonDraft={setPolygonDraft}
          onRegisterSnapshotGetter={handleRegisterSnapshotGetter}
          onNotify={notify}
        />

        <DrawingToolbar
          activeTool={activeTool}
          onSelectTool={(t) => {
            setActiveTool(t);
            setPolygonDraft([]);
          }}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      </main>

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        currentProject={project}
        savedProjects={savedProjects}
        onLoadProject={(proj) => {
          setProject(proj);
          setPast([]);
          setFuture([]);
          setSelectedLineIds([]);
          setSelectedSurfaceId(null);
          setPolygonDraft([]);
        }}
        onSaveCurrentProject={(updatedName) => {
          setProject((prev) => ({
            ...prev,
            name: updatedName || prev.name,
            updatedAt: Date.now(),
          }));
        }}
        onDeleteProject={(id) => {
          if (savedProjects.length <= 1) {
            notify('Impossible de supprimer le seul projet existant.', 'error');
            return;
          }
          const filtered = savedProjects.filter((p) => p.id !== id);
          setSavedProjects(filtered);
          localStorage.setItem(STORAGE_LIST_KEY, JSON.stringify(filtered));
          if (project.id === id && filtered.length > 0) {
            setProject(filtered[0]);
          }
        }}
        onNotify={notify}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        project={project}
        get3DSnapshot={() => snapshot3DGetterRef.current()}
        onNotify={notify}
      />
    </div>
  );
}

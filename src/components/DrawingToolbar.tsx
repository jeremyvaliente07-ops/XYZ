import React from 'react';
import {
  Box,
  Compass,
  Eraser,
  GitCommitHorizontal,
  Hand,
  Minus,
  MousePointer,
  Move,
  Pentagon,
  Redo2,
  Undo2,
} from 'lucide-react';
import { ToolId } from '../types/cad';

interface DrawingToolbarProps {
  activeTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) => {
  const tools: { id: ToolId; label: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Sélection', icon: <MousePointer className="w-4 h-4" /> },
    { id: 'line', label: 'Ligne', icon: <Minus className="w-4 h-4 -rotate-45" /> },
    { id: 'angled_line', label: 'Angle', icon: <Compass className="w-4 h-4" /> },
    { id: 'surface', label: 'Surface', icon: <Pentagon className="w-4 h-4" /> },
    { id: 'extrude', label: 'Volume', icon: <Box className="w-4 h-4" /> },
    { id: 'move', label: 'Déplacer', icon: <Move className="w-4 h-4" /> },
    { id: 'edit_endpoints', label: 'Points', icon: <GitCommitHorizontal className="w-4 h-4" /> },
    { id: 'eraser', label: 'Gomme', icon: <Eraser className="w-4 h-4" /> },
    { id: 'orbit', label: 'Tourner 3D', icon: <Hand className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 flex items-center gap-1 select-none max-w-[96vw] overflow-x-auto">
      {tools.map((t) => {
        const isActive = activeTool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelectTool(t.id)}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              isActive
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        );
      })}

      <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-35 rounded-lg transition-colors shrink-0"
        title="Annuler (Ctrl+Z)"
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-35 rounded-lg transition-colors shrink-0"
        title="Rétablir (Ctrl+Y)"
      >
        <Redo2 className="w-4 h-4" />
      </button>
    </div>
  );
};

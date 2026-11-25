import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  FilePlus,
  FolderOpen,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { CADProject, UnitType } from '../types/cad';
import { executeExport } from '../utils/exporters';
import { createBlankProject } from '../utils/templates';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject: CADProject;
  savedProjects: CADProject[];
  onLoadProject: (project: CADProject) => void;
  onSaveCurrentProject: (updatedName?: string) => void;
  onDeleteProject: (id: string) => void;
  onNotify: (msg: string, type?: 'info' | 'error' | 'success') => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  currentProject,
  savedProjects,
  onLoadProject,
  onSaveCurrentProject,
  onDeleteProject,
  onNotify,
}) => {
  const [newProjName, setNewProjName] = useState<string>('Mon Dessin');
  const [newProjUnit, setNewProjUnit] = useState<UnitType>('cm');
  const [newProjCellSize, setNewProjCellSize] = useState<number>(1);
  const [renameValue, setRenameValue] = useState<string>(currentProject.name);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setRenameValue(currentProject.name);
    }
  }, [isOpen, currentProject.id, currentProject.name]);

  if (!isOpen) return null;

  const handleCreateNew = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProjName.trim() || 'Nouveau Projet';
    const validCellSize = Math.max(0.1, Number(newProjCellSize) || 1);
    const fresh = createBlankProject(trimmed, newProjUnit, validCellSize);
    onLoadProject(fresh);
    onNotify(`Projet vierge « ${trimmed} » créé.`, 'success');
    onClose();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const proj: CADProject = parsed.project ? parsed.project : parsed;
        if (!proj || typeof proj.name !== 'string' || !Array.isArray(proj.lines)) {
          throw new Error('Fichier invalide');
        }
        onLoadProject(proj);
        onNotify(`Projet « ${proj.name} » chargé.`, 'success');
        onClose();
      } catch {
        onNotify('Ce fichier n’est pas un projet XYZ Studio valide.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-bold text-slate-900">Mes Projets</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-500 hover:text-slate-900 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* 1. Projet en cours */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="text-xs font-semibold text-slate-900">Projet en cours</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                placeholder="Nom du projet"
              />
              <button
                type="button"
                onClick={() => {
                  onSaveCurrentProject(renameValue.trim() || currentProject.name);
                  onNotify('Nom du projet enregistré.', 'success');
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                Enregistrer
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const res = executeExport(currentProject, 'FULL', 'XYZ');
                  onNotify(res.message, 'success');
                }}
                className="flex-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-medium rounded-md flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Télécharger une copie (.xyz)
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-medium rounded-md flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                Ouvrir un fichier (.xyz)
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.xyz"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>
          </div>

          {/* 2. Nouveau projet */}
          <form onSubmit={handleCreateNew} className="p-4 border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <FilePlus className="w-4 h-4 text-slate-700" />
              Nouveau projet vierge
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                required
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="Nom"
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
              <select
                value={newProjUnit}
                onChange={(e) => setNewProjUnit(e.target.value as UnitType)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="mm">Millimètres (mm)</option>
                <option value="cm">Centimètres (cm)</option>
                <option value="m">Mètres (m)</option>
              </select>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  required
                  value={newProjCellSize}
                  onChange={(e) => setNewProjCellSize(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                />
                <span className="text-[11px] text-slate-500 whitespace-nowrap">/ case</span>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md transition-colors"
            >
              Créer une feuille vierge
            </button>
          </form>

          {/* 3. Projets sauvegardés */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-slate-700" />
              Projets sauvegardés ({savedProjects.length})
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-48 overflow-y-auto">
              {savedProjects.map((proj) => {
                const isCurrent = proj.id === currentProject.id;
                return (
                  <div
                    key={proj.id}
                    className={`flex items-center justify-between px-3.5 py-2.5 text-xs ${
                      isCurrent ? 'bg-slate-50' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="min-w-0 pr-3">
                      <div className="font-semibold text-slate-900 truncate">
                        {proj.name}{' '}
                        {isCurrent && (
                          <span className="text-[11px] font-normal text-emerald-700">· Ouvert</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {proj.lines.length} lignes · {proj.surfaces.length} surfaces · Unité {proj.grid.unit}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => {
                            onLoadProject(proj);
                            onNotify(`Projet « ${proj.name} » ouvert.`, 'info');
                            onClose();
                          }}
                          className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded"
                        >
                          Ouvrir
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteProject(proj.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

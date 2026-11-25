import React, { useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import { CADProject, ExportFormat, ExportTarget } from '../types/cad';
import { executeExport } from '../utils/exporters';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: CADProject;
  get3DSnapshot: () => HTMLCanvasElement | string | null;
  onNotify: (msg: string, type?: 'info' | 'error' | 'success') => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  project,
  get3DSnapshot,
  onNotify,
}) => {
  const [target, setTarget] = useState<ExportTarget>('3D');
  const [format, setFormat] = useState<ExportFormat>('PNG');

  if (!isOpen) return null;

  const targets: { id: ExportTarget; label: string; color: string }[] = [
    { id: '3D', label: 'Vue 3D', color: 'text-slate-900' },
    { id: 'TOP', label: 'Vue de Haut', color: 'text-blue-600' },
    { id: 'FRONT', label: 'Vue de Face', color: 'text-red-600' },
    { id: 'SIDE', label: 'Vue de Côté', color: 'text-green-600' },
    { id: 'FULL', label: 'Planche complète', color: 'text-slate-900' },
  ];

  const formats: { id: ExportFormat; label: string; desc: string }[] = [
    { id: 'PNG', label: 'PNG', desc: 'Image nette' },
    { id: 'JPG', label: 'JPG', desc: 'Image légère' },
    { id: 'PDF', label: 'PDF', desc: 'Page à imprimer' },
    { id: 'OBJ', label: 'OBJ 3D', desc: 'Modèle 3D réel' },
  ];

  const handleRunExport = () => {
    const result = executeExport(project, target, format, get3DSnapshot);
    if (result.success) {
      onNotify(result.message, 'success');
      onClose();
    } else {
      onNotify(result.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-bold text-slate-900">Exporter</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-500 hover:text-slate-900 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="text-xs font-semibold text-slate-900 mb-2">
              1. Choisir la vue à exporter
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {targets.map((t) => {
                const active = target === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTarget(t.id)}
                    className={`px-3 py-2.5 rounded-lg border text-xs font-semibold flex items-center justify-between transition-colors ${
                      active
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <span className={t.color}>{t.label}</span>
                    {active && <Check className="w-3.5 h-3.5 text-slate-900 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-900 mb-2">
              2. Choisir le format
            </div>
            <div className="grid grid-cols-4 gap-2">
              {formats.map((f) => {
                const active = format === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormat(f.id)}
                    className={`p-2.5 rounded-lg border text-left transition-colors ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-900'
                    }`}
                  >
                    <div className="text-xs font-bold">{f.label}</div>
                    <div className={`text-[11px] mt-0.5 ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                      {f.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 rounded-lg"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleRunExport}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Télécharger
          </button>
        </div>
      </div>
    </div>
  );
};

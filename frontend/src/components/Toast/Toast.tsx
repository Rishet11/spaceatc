import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { useSpaceStore, ToastItem } from '../../store/useSpaceStore';

const LEVEL_STYLES: Record<ToastItem['level'], { border: string; text: string; Icon: typeof Info }> = {
  info: { border: 'border-sky-400/60', text: 'text-sky-200', Icon: Info },
  error: { border: 'border-red-500/60', text: 'text-red-200', Icon: AlertTriangle },
  success: { border: 'border-emerald-400/60', text: 'text-emerald-200', Icon: CheckCircle },
};

const AUTO_DISMISS_MS = 6000;

function ToastRow({ toast }: { toast: ToastItem }) {
  const dismissToast = useSpaceStore((s) => s.dismissToast);
  const { border, text, Icon } = LEVEL_STYLES[toast.level];

  useEffect(() => {
    const t = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast.id, dismissToast]);

  return (
    <div
      className={`flex items-start gap-2 max-w-sm bg-black/85 backdrop-blur border ${border} rounded-md px-3 py-2 shadow-lg`}
      role="alert"
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${text}`} />
      <span className={`text-xs leading-snug ${text}`}>{toast.message}</span>
      <button
        onClick={() => dismissToast(toast.id)}
        className="ml-auto text-white/40 hover:text-white/80 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ToastHost() {
  const toasts = useSpaceStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}

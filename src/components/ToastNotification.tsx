import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { Toast } from '../hooks/useToast';

interface ToastNotificationProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

export function ToastNotification({ toast, onRemove }: ToastNotificationProps) {
  const icons = {
    success: <CheckCircle2 className="w-5 h-5" />,
    error: <XCircle className="w-5 h-5" />,
    warning: <AlertTriangle className="w-5 h-5" />,
    info: <Info className="w-5 h-5" />
  };

  const styles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800'
  };

  const iconStyles = {
    success: 'text-green-600',
    error: 'text-red-600',
    warning: 'text-yellow-600',
    info: 'text-blue-600'
  };

  return (
    <div
      className={`
        ${styles[toast.type]}
        border rounded-lg p-4 shadow-lg
        flex items-start gap-3
        animate-slide-in-right
        min-w-[320px] max-w-[420px]
      `}
    >
      <div className={iconStyles[toast.type]}>
        {icons[toast.type]}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm mb-1">
          {toast.title}
        </h4>
        <p className="text-sm opacity-90">
          {toast.message}
        </p>
      </div>

      <button
        onClick={() => onRemove(toast.id)}
        className="opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastNotification toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}

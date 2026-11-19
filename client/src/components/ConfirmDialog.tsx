import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible modal confirmation dialog using native `<dialog>` and `showModal()`.
 * Follows Modern Web Guidance (`dialog`): no redundant role/aria-modal, autofocus
 * on the safe Cancel action, returnValue reset on close, and light-dismiss fallback.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      const choice = dialog.returnValue;
      // Reset returnValue so stale values never leak on subsequent Esc dismissals
      dialog.returnValue = '';
      if (choice === 'confirm') {
        onConfirm();
      } else {
        onCancel();
      }
    };

    dialog.addEventListener('close', handleClose);

    // Light-dismiss fallback for browsers without `closedby="any"`
    let cleanupFallback: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          dialog.close('cancel');
        }
      };
      dialog.addEventListener('pointerdown', onDown);
      dialog.addEventListener('pointerup', onUp);
      cleanupFallback = () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('pointerup', onUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupFallback?.();
    };
  }, [onConfirm, onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog"
      aria-labelledby="confirm-dialog-title"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="modal-content">
        <h2 id="confirm-dialog-title" className="modal-title">
          {title}
        </h2>
        <p className="modal-desc">{description}</p>
        <form method="dialog" className="modal-actions">
          <button type="submit" value="cancel" className="btn btn-secondary" autoFocus>
            {cancelLabel}
          </button>
          <button
            type="submit"
            value="confirm"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
          >
            {confirmLabel}
          </button>
        </form>
      </div>
    </dialog>
  );
}

import { useEffect, type ReactNode } from "react";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Schlichtes modales Overlay im App-Theme. Inline im Komponentenbaum
 * gerendert (kein Portal) und per `position: fixed` über die ganze Fläche
 * gelegt. Schließt per Backdrop-Klick und Escape; der Dialog selbst stoppt
 * die Klick-Propagation.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close" aria-label="Schließen" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

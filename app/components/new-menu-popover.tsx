import { useEffect, useId, useRef } from "react";

export function NewMenuPopover({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  function dismiss() {
    dialogRef.current?.close();
    onClose();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeButtonRef.current?.focus();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="new-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        // Close is the only action in this stage's explanatory dialog.
        if (event.key === "Tab") {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }
      }}
    >
      <h2 id={titleId}>New window</h2>
      <p id={descriptionId}>
        Opening Chart, Level II, and T &amp; S windows will be available in the next stage.
      </p>
      <button ref={closeButtonRef} type="button" onClick={dismiss}>Close</button>
    </dialog>
  );
}

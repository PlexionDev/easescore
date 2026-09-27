"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Content = { title: string; body: ReactNode };
type Show = (title: string, body: ReactNode) => void;

const DialogContext = createContext<Show>(() => {});

/** One shared modal for source receipts and credits. Returns focus to the control that opened it. */
export function useInfoDialog() {
  return useContext(DialogContext);
}

export default function InfoDialogProvider({ children, scopeClass }: { children: ReactNode; scopeClass?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const [content, setContent] = useState<Content | null>(null);

  const show = useCallback<Show>((title, body) => {
    returnFocus.current = document.activeElement;
    setContent({ title, body });
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!content || !d) return;
    if (!d.open) d.showModal();
    closeRef.current?.focus();
  }, [content]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClose = () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement && document.contains(el)) el.focus({ preventScroll: true });
    };
    // A click on the backdrop lands on the dialog element itself, outside its box.
    const onClick = (e: MouseEvent) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    };
    d.addEventListener("close", onClose);
    d.addEventListener("click", onClick);
    return () => {
      d.removeEventListener("close", onClose);
      d.removeEventListener("click", onClick);
    };
  }, []);

  const dialog = (
    <dialog ref={ref} aria-labelledby="dialog-title">
      <div className="dialog-header">
        <h2 id="dialog-title">{content?.title}</h2>
        <button ref={closeRef} type="button" aria-label="Close dialog" onClick={() => ref.current?.close()}>×</button>
      </div>
      <div className="dialog-body">{content?.body}</div>
    </dialog>
  );

  return (
    <DialogContext.Provider value={show}>
      {children}
      {scopeClass ? <div className={scopeClass}>{dialog}</div> : dialog}
    </DialogContext.Provider>
  );
}

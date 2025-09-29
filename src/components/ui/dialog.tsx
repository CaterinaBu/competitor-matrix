import React, { useEffect } from "react";
import { createPortal } from "react-dom";

export function Dialog({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (o: boolean) => void; children?: React.ReactNode; }) {
  useEffect(() => { document.body.style.overflow = open ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange?.(false)} />
      <div className="relative z-10">{children}</div>
    </div>,
    document.body
  );
}

export function DialogContent({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return <div className={"bg-white rounded-lg shadow-lg border p-4 " + className}>{children}</div>;
}
export function DialogHeader({ children }: { children?: React.ReactNode }) { return <div className="mb-2">{children}</div>; }
export function DialogTitle({ children }: { children?: React.ReactNode }) { return <h3 className="text-lg font-semibold">{children}</h3>; }
export function DialogFooter({ children }: { children?: React.ReactNode }) { return <div className="mt-3 flex gap-2 justify-end">{children}</div>; }

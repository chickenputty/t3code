import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";

export interface MobileContextMenuItem {
  id: string;
  label: string;
  destructive?: boolean;
  icon?: React.ReactNode;
}

interface MobileContextMenuProps {
  open: boolean;
  items: MobileContextMenuItem[];
  position: { x: number; y: number };
  onSelect: (id: string) => void;
  onClose: () => void;
  title?: string | undefined;
}

/**
 * A mobile-friendly context menu triggered by long-press.
 * Renders as a bottom-sheet action sheet with large touch targets
 * and a separate Cancel button, similar to iOS action sheets.
 * Stays open until the user picks an option or explicitly dismisses it.
 */
export function MobileContextMenu({
  open,
  items,
  onSelect,
  onClose,
  title,
}: MobileContextMenuProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Animate-in on open
  useEffect(() => {
    if (open) {
      // Force a frame so the initial styles apply, then transition in
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleOverlayInteraction = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (e.target === overlayRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 150ms ease-out",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
      }}
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/40 backdrop-blur-[2px] select-none"
      onClick={handleOverlayInteraction}
      onTouchEnd={handleOverlayInteraction}
      role="dialog"
      aria-modal="true"
      aria-label="Context menu"
    >
      <div
        style={{
          transform: visible ? "translateY(0)" : "translateY(1rem)",
          opacity: visible ? 1 : 0,
          transition: "transform 200ms ease-out, opacity 200ms ease-out",
        }}
        className="w-full max-w-sm"
        role="menu"
        aria-orientation="vertical"
      >
        <div className="mx-3 mb-3 overflow-hidden rounded-2xl border border-border/50 bg-popover shadow-xl">
          {/* Header with title and close button */}
          {title && (
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <span className="truncate text-sm font-medium text-foreground/80">{title}</span>
              <button
                type="button"
                onClick={onClose}
                className="ml-2 flex shrink-0 items-center justify-center rounded-full p-1.5 text-muted-foreground/60 active:bg-accent/80"
                aria-label="Close menu"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          )}

          {/* Menu items - large touch targets for mobile */}
          <div className="py-1.5">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] transition-colors active:bg-accent/80 ${
                  item.destructive
                    ? "text-red-500 dark:text-red-400 active:bg-red-500/10"
                    : "text-foreground active:bg-accent"
                } ${index > 0 ? "border-t border-border/20" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(item.id);
                }}
              >
                {item.icon && (
                  <span className="flex shrink-0 items-center justify-center opacity-70">
                    {item.icon}
                  </span>
                )}
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Cancel button - separate card for a clear dismissal target */}
        <div className="mx-3 mb-3">
          <button
            type="button"
            role="menuitem"
            className="w-full rounded-2xl border border-border/50 bg-popover py-3.5 text-center text-[15px] font-semibold text-foreground shadow-xl transition-colors active:bg-accent/80"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

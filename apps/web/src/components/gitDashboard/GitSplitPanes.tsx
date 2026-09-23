import { useRef, useState, type CSSProperties, type ReactNode } from "react";

const STORAGE_KEY = "t3code:git-panel:changes-share";
const DEFAULT_SHARE = 0.7;
const MIN_SHARE = 0.1;
const MAX_SHARE = 0.9;

const clampShare = (share: number) => Math.min(MAX_SHARE, Math.max(MIN_SHARE, share));

const readStoredShare = () => {
  const stored = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
  return stored > 0 ? clampShare(stored) : DEFAULT_SHARE;
};

/**
 * An open pane above another open one takes its share, the last open pane takes the rest,
 * and a closed pane keeps only its header.
 */
const paneStyle = (open: boolean, openBelow: boolean, share: number): CSSProperties =>
  !open ? { flex: "none" } : openBelow ? { flex: `0 0 ${share * 100}%` } : { flex: "1 1 0%" };

/**
 * Two stacked panes with a draggable divider, like VS Code's Source Control views. The split
 * is remembered across reloads. Dragging only re-renders this component: the panes are
 * elements from the parent, so React skips them.
 */
export function GitSplitPanes(props: {
  readonly top: ReactNode;
  readonly bottom: ReactNode;
  readonly topOpen: boolean;
  readonly bottomOpen: boolean;
}) {
  const [share, setShare] = useState(readStoredShare);
  const [dragShare, setDragShare] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = dragShare ?? share;

  const commit = (next: number) => {
    const clamped = clampShare(next);
    setShare(clamped);
    setDragShare(null);
    globalThis.localStorage?.setItem(STORAGE_KEY, String(clamped));
  };
  const shareAt = (clientY: number) => {
    const container = containerRef.current?.getBoundingClientRect();
    if (!container || container.height === 0) return current;
    return clampShare((clientY - container.top) / container.height);
  };

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex min-h-0 flex-col"
        style={paneStyle(props.topOpen, props.bottomOpen, current)}
      >
        {props.top}
      </div>
      {props.topOpen && props.bottomOpen ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize changes and graph"
          aria-valuenow={Math.round(current * 100)}
          aria-valuemin={MIN_SHARE * 100}
          aria-valuemax={MAX_SHARE * 100}
          tabIndex={0}
          className="relative z-20 h-px shrink-0 cursor-row-resize bg-border/70 outline-none before:absolute before:inset-x-0 before:-top-1 before:-bottom-1 hover:bg-primary/60 focus-visible:bg-primary"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              setDragShare(shareAt(event.clientY));
            }
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            commit(shareAt(event.clientY));
          }}
          onKeyDown={(event) => {
            const step = event.key === "ArrowUp" ? -0.05 : event.key === "ArrowDown" ? 0.05 : 0;
            if (step === 0) return;
            event.preventDefault();
            commit(share + step);
          }}
        />
      ) : null}
      <div className="flex min-h-0 flex-col" style={paneStyle(props.bottomOpen, false, 0)}>
        {props.bottom}
      </div>
    </div>
  );
}

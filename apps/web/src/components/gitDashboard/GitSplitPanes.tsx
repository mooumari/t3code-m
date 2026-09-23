import { Fragment, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** One stacked section. A closed pane keeps only its header. */
export interface GitSplitPane {
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  /** Relative size until the user drags a divider. */
  readonly defaultWeight: number;
  readonly node: ReactNode;
}

type Weights = Readonly<Record<string, number>>;

const MIN_PANE_PX = 72;
const KEYBOARD_STEP_PX = 24;

const readStoredWeights = (storageKey: string): Weights => {
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "null");
    if (stored === null || typeof stored !== "object") return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
};

const paneStyle = (open: boolean, weight: number): CSSProperties =>
  open ? { flex: `${weight} 1 0%`, minHeight: MIN_PANE_PX } : { flex: "none" };

/**
 * Stacked sections with draggable dividers, like VS Code's Source Control views. Each open
 * pane takes a share of the height by weight; a divider moves height between the open panes
 * on either side of it. Sizes are remembered under `storageKey`. Dragging only re-renders
 * this component: the panes are elements from the parent, so React skips them.
 */
export function GitSplitPanes(props: {
  readonly storageKey: string;
  readonly panes: ReadonlyArray<GitSplitPane>;
}) {
  const [stored, setStored] = useState(() => readStoredWeights(props.storageKey));
  const [dragged, setDragged] = useState<Weights | null>(null);
  const dragStart = useRef<{ clientY: number; above: number; below: number } | null>(null);

  const weights = { ...stored, ...dragged };
  const weightOf = (pane: GitSplitPane) => weights[pane.id] ?? pane.defaultWeight;

  const save = (next: Weights) => {
    const merged = { ...stored, ...next };
    setStored(merged);
    setDragged(null);
    globalThis.localStorage?.setItem(props.storageKey, JSON.stringify(merged));
  };

  // Moves `deltaPx` of height from the pane below the divider to the pane above it.
  const resized = (
    above: GitSplitPane,
    below: GitSplitPane,
    abovePx: number,
    belowPx: number,
    deltaPx: number,
  ): Weights => {
    const totalPx = abovePx + belowPx;
    const totalWeight = weightOf(above) + weightOf(below);
    if (totalPx <= 0) return {};
    const nextAbovePx = Math.min(totalPx - MIN_PANE_PX, Math.max(MIN_PANE_PX, abovePx + deltaPx));
    const aboveWeight = (totalWeight * nextAbovePx) / totalPx;
    return { [above.id]: aboveWeight, [below.id]: totalWeight - aboveWeight };
  };

  const paneHeight = (divider: HTMLElement, id: string) =>
    divider.parentElement
      ?.querySelector<HTMLElement>(`[data-git-pane="${id}"]`)
      ?.getBoundingClientRect().height ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {props.panes.map((pane, index) => {
        const below = pane.open ? props.panes.slice(index + 1).find((next) => next.open) : null;
        return (
          <Fragment key={pane.id}>
            <div
              data-git-pane={pane.id}
              className="flex min-h-0 flex-col"
              style={paneStyle(pane.open, weightOf(pane))}
            >
              {pane.node}
            </div>
            {below ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={`Resize ${pane.label} and ${below.label}`}
                tabIndex={0}
                className="relative z-20 h-px shrink-0 cursor-row-resize bg-border/70 outline-none before:absolute before:inset-x-0 before:-top-1 before:-bottom-1 hover:bg-primary/60 focus-visible:bg-primary"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  event.preventDefault();
                  dragStart.current = {
                    clientY: event.clientY,
                    above: paneHeight(event.currentTarget, pane.id),
                    below: paneHeight(event.currentTarget, below.id),
                  };
                }}
                onPointerMove={(event) => {
                  const start = dragStart.current;
                  if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  setDragged(
                    resized(pane, below, start.above, start.below, event.clientY - start.clientY),
                  );
                }}
                onPointerUp={(event) => {
                  const start = dragStart.current;
                  dragStart.current = null;
                  if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  save(
                    resized(pane, below, start.above, start.below, event.clientY - start.clientY),
                  );
                }}
                onKeyDown={(event) => {
                  const step =
                    event.key === "ArrowUp"
                      ? -KEYBOARD_STEP_PX
                      : event.key === "ArrowDown"
                        ? KEYBOARD_STEP_PX
                        : 0;
                  if (step === 0) return;
                  event.preventDefault();
                  const divider = event.currentTarget;
                  save(
                    resized(
                      pane,
                      below,
                      paneHeight(divider, pane.id),
                      paneHeight(divider, below.id),
                      step,
                    ),
                  );
                }}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

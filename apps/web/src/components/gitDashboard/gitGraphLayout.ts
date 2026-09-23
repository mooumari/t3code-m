/** A line inside one row, from a lane at the row's top (or middle) to a lane at its middle (or bottom). */
export interface GraphSegment {
  readonly from: number;
  readonly to: number;
  readonly color: number;
}

export interface GraphRow {
  /** Lane of the commit's dot. */
  readonly lane: number;
  readonly color: number;
  /** Lines from the row's top edge to its middle. */
  readonly top: ReadonlyArray<GraphSegment>;
  /** Lines from the row's middle to its bottom edge. */
  readonly bottom: ReadonlyArray<GraphSegment>;
  /** Lanes still open below the row, drawn through anything shown under it. */
  readonly through: ReadonlyArray<{ readonly lane: number; readonly color: number }>;
  /** Lanes this row spans, for sizing its graph column. */
  readonly width: number;
}

/**
 * Lays out commits (newest first, parents after children, as `git log --date-order`
 * prints them) into lanes. A lane waits for a specific commit; a commit takes the lane
 * that waits for it, and hands the lane on to its first parent.
 */
export function layoutGraph(
  commits: ReadonlyArray<{ readonly sha: string; readonly parents: ReadonlyArray<string> }>,
): GraphRow[] {
  const lanes: Array<string | null> = [];
  const colors: number[] = [];
  let nextColor = 0;
  const rows: GraphRow[] = [];

  const claimLane = (sha: string) => {
    let index = lanes.indexOf(null);
    if (index === -1) index = lanes.length;
    lanes[index] = sha;
    colors[index] = nextColor++;
    return index;
  };

  for (const commit of commits) {
    const before = lanes.slice();
    let lane = lanes.indexOf(commit.sha);
    if (lane === -1) lane = claimLane(commit.sha);
    const color = colors[lane]!;

    const top: GraphSegment[] = [];
    before.forEach((waitingFor, index) => {
      if (waitingFor === null) return;
      top.push({
        from: index,
        to: waitingFor === commit.sha ? lane : index,
        color: colors[index]!,
      });
    });
    // Every other lane that waited for this commit ends here.
    lanes.forEach((waitingFor, index) => {
      if (waitingFor === commit.sha && index !== lane) lanes[index] = null;
    });

    const bottom: GraphSegment[] = [];
    const opened = new Set<number>();
    const [firstParent, ...otherParents] = commit.parents;
    if (firstParent === undefined) {
      lanes[lane] = null;
    } else {
      const existing = lanes.indexOf(firstParent);
      if (existing !== -1 && existing !== lane) {
        // Another lane already leads to the parent: join it instead of running alongside.
        lanes[lane] = null;
        bottom.push({ from: lane, to: existing, color });
      } else {
        lanes[lane] = firstParent;
        bottom.push({ from: lane, to: lane, color });
      }
    }
    for (const parent of otherParents) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = claimLane(parent);
        opened.add(target);
      }
      bottom.push({ from: lane, to: target, color: colors[target]! });
    }
    lanes.forEach((waitingFor, index) => {
      if (waitingFor !== null && index !== lane && !opened.has(index)) {
        bottom.push({ from: index, to: index, color: colors[index]! });
      }
    });

    while (lanes.length > 0 && lanes.at(-1) === null) {
      lanes.pop();
      colors.pop();
    }
    const through = lanes.flatMap((waitingFor, index) =>
      waitingFor === null ? [] : [{ lane: index, color: colors[index]! }],
    );
    rows.push({
      lane,
      color,
      top,
      bottom,
      through,
      width: Math.max(before.length, lanes.length, lane + 1),
    });
  }
  return rows;
}

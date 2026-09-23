import { describe, expect, it } from "vite-plus/test";

import { layoutGraph } from "./gitGraphLayout";

const commit = (sha: string, ...parents: string[]) => ({ sha, parents });

describe("layoutGraph", () => {
  it("keeps a straight history in one lane", () => {
    const rows = layoutGraph([commit("c", "b"), commit("b", "a"), commit("a")]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.width)).toEqual([1, 1, 1]);
    expect(rows[2]!.bottom).toEqual([]);
  });

  it("opens a lane for a merged branch and joins it back at the shared parent", () => {
    const rows = layoutGraph([
      commit("merge", "main-1", "side-1"),
      commit("main-1", "base"),
      commit("side-1", "base"),
      commit("base"),
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
    // The merge draws down its own lane and out to the side branch's new lane.
    expect(rows[0]!.bottom.map(({ from, to }) => [from, to])).toEqual([
      [0, 0],
      [0, 1],
    ]);
    // The side branch's last commit joins the main lane instead of running alongside.
    expect(rows[2]!.bottom.map(({ from, to }) => [from, to])).toEqual([
      [1, 0],
      [0, 0],
    ]);
    expect(rows[3]!.width).toBe(1);
    expect(rows[1]!.color).not.toBe(rows[2]!.color);
  });

  it("gives branch tips that nothing waits for their own lane", () => {
    const rows = layoutGraph([commit("feature", "base"), commit("main", "base"), commit("base")]);
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0]);
    expect(rows[1]!.through.map((lane) => lane.lane)).toEqual([0]);
    expect(rows[2]!.top.map(({ from, to }) => [from, to])).toEqual([[0, 0]]);
  });
});

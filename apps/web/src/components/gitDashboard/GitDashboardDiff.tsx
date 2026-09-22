import type { EnvironmentId, GitDashboardFileDiffInput } from "@t3tools/contracts";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { getRenderablePatch, resolveDiffThemeName, resolveFileDiffPath } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { gitDashboardEnvironment } from "~/state/gitDashboard";
import { useEnvironmentQuery } from "~/state/query";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { Spinner } from "../ui/spinner";

export function GitDashboardDiff(props: {
  readonly environmentId: EnvironmentId;
  readonly input: GitDashboardFileDiffInput;
}) {
  const { resolvedTheme } = useTheme();
  const diffQuery = useEnvironmentQuery(
    gitDashboardEnvironment.fileDiff({ environmentId: props.environmentId, input: props.input }),
  );
  const patch = diffQuery.data?.patch;
  const renderable = useMemo(
    () => getRenderablePatch(patch, `git-dashboard:${resolvedTheme}`),
    [patch, resolvedTheme],
  );

  if (diffQuery.error && !diffQuery.data) {
    return <p className="p-4 text-destructive-foreground text-sm">{diffQuery.error}</p>;
  }
  if (!diffQuery.data) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
        <Spinner className="size-4" /> Loading diff…
      </div>
    );
  }
  if (!renderable) {
    return <p className="p-4 text-muted-foreground text-sm">No textual changes.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {diffQuery.data.truncated ? (
        <p className="px-1 text-warning-foreground text-xs">
          This diff is very large and was cut short.
        </p>
      ) : null}
      {renderable.kind === "files" ? (
        <DiffWorkerPoolProvider>
          {renderable.files.map((fileDiff) => (
            <FileDiff
              key={resolveFileDiffPath(fileDiff)}
              fileDiff={fileDiff}
              options={{
                collapsed: false,
                diffStyle: "unified",
                theme: resolveDiffThemeName(resolvedTheme),
                preferredHighlighter: PREFERRED_HIGHLIGHTER,
              }}
            />
          ))}
        </DiffWorkerPoolProvider>
      ) : (
        <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs">{renderable.text}</pre>
      )}
    </div>
  );
}

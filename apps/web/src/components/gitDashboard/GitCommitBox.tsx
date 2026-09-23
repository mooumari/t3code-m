import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, GitActionProgressEvent, GitStackedAction } from "@t3tools/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudUploadIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { randomUUID } from "~/lib/utils";
import {
  useGitStackedAction,
  useSourceControlActionRunning,
  useVcsPullAction,
} from "~/state/sourceControlActions";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";

const errorMessage = (result: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
};

/**
 * VS Code's commit box: a message (left empty, the server writes one), Commit, and Sync once
 * the work is committed. Reuses the same server actions as the thread header's Git menu.
 */
export function GitCommitBox(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly branch: string | null;
  readonly hasUpstream: boolean;
  readonly changeCount: number;
  /** When any files are staged, only they are committed, as in VS Code. */
  readonly stagedPaths: ReadonlyArray<string>;
  readonly stagedFileCount: number;
  readonly aheadCount: number;
  readonly behindCount: number;
  /** Threads whose agent is working in this checkout right now. */
  readonly workingThreadCount: number;
}) {
  const scope = useMemo(
    () => ({ environmentId: props.environmentId, cwd: props.cwd }),
    [props.environmentId, props.cwd],
  );
  const stackedAction = useGitStackedAction(scope);
  const pullAction = useVcsPullAction(scope);
  const running = useSourceControlActionRunning(scope, ["runStackedAction", "pull"]);
  const [message, setMessage] = useState("");

  // Warns rather than blocks: the user may know the agent is idle between tool calls.
  const confirmWhileAgentWorks = async () => {
    if (props.workingThreadCount === 0) return true;
    const confirmation = requestConfirmDialog(
      `${props.workingThreadCount === 1 ? "An agent is" : `${props.workingThreadCount} agents are`} still working here. Continue anyway?\nIts next edits could land in this commit, or clash with the push.`,
    );
    return confirmation === undefined ? true : await confirmation;
  };

  const runStacked = async (
    action: GitStackedAction,
    commitMessage?: string,
    filePaths?: ReadonlyArray<string>,
  ) => {
    const toastId = toastManager.add({
      type: "loading",
      title: action === "push" ? "Pushing…" : "Committing…",
      timeout: 0,
    });
    const onProgress = (event: GitActionProgressEvent) => {
      if (event.kind === "phase_started") {
        toastManager.update(toastId, { type: "loading", title: event.label, timeout: 0 });
      }
    };
    const result = await stackedAction.run({
      actionId: randomUUID(),
      action,
      ...(commitMessage ? { commitMessage } : {}),
      ...(filePaths?.length ? { filePaths: [...filePaths] } : {}),
      onProgress,
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) toastManager.close(toastId);
      else
        toastManager.update(toastId, {
          type: "error",
          title: "Git action failed",
          description: errorMessage(result),
        });
      return false;
    }
    toastManager.update(toastId, {
      type: "success",
      title: result.value.toast.title,
      description: result.value.toast.description,
    });
    return true;
  };

  const commit = async (push: boolean) => {
    if (!(await confirmWhileAgentWorks())) return;
    const trimmed = message.trim();
    // The server re-adds these files whole, so a partly staged file commits all its changes.
    const committed = await runStacked(
      push ? "commit_push" : "commit",
      trimmed || undefined,
      props.stagedPaths,
    );
    if (committed) setMessage("");
  };

  const sync = async () => {
    if (!(await confirmWhileAgentWorks())) return;
    if (props.behindCount > 0) {
      const toastId = toastManager.add({ type: "loading", title: "Pulling…", timeout: 0 });
      const result = await pullAction.run();
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) toastManager.close(toastId);
        else
          toastManager.update(toastId, {
            type: "error",
            title: "Pull failed",
            description: errorMessage(result),
          });
        return;
      }
      toastManager.close(toastId);
    }
    if (props.aheadCount > 0 || !props.hasUpstream) await runStacked("push");
  };

  const canCommit = props.changeCount > 0;
  const commitsOnlyStaged =
    props.stagedPaths.length > 0 && props.changeCount > props.stagedFileCount;
  const canSync =
    !canCommit &&
    props.branch !== null &&
    (!props.hasUpstream || props.aheadCount > 0 || props.behindCount > 0);

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-1 pb-2">
      <Textarea
        size="sm"
        rows={2}
        aria-label="Commit message"
        placeholder={`Message (⌘Enter to commit${props.branch ? ` on "${props.branch}"` : ""}). Leave empty to write one for you.`}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canCommit && !running) {
            event.preventDefault();
            void commit(false);
          }
        }}
      />
      {canCommit ? (
        <Group aria-label="Commit" className="w-full">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={running}
            onClick={() => void commit(false)}
          >
            <CheckIcon aria-hidden />
            {commitsOnlyStaged ? "Commit staged" : "Commit"}
          </Button>
          <GroupSeparator />
          <Menu>
            <MenuTrigger
              disabled={running}
              render={<Button type="button" size="icon-sm" aria-label="More commit actions" />}
            >
              <ChevronDownIcon aria-hidden />
            </MenuTrigger>
            <MenuPopup align="end" side="bottom">
              <MenuItem onClick={() => void commit(true)}>Commit & push</MenuItem>
            </MenuPopup>
          </Menu>
        </Group>
      ) : canSync ? (
        <Button type="button" size="sm" disabled={running} onClick={() => void sync()}>
          {props.hasUpstream ? (
            <>
              <RefreshCwIcon aria-hidden />
              Sync changes
              {props.behindCount > 0 ? (
                <span className="flex items-center tabular-nums">
                  {props.behindCount}
                  <ArrowDownIcon aria-hidden />
                </span>
              ) : null}
              {props.aheadCount > 0 ? (
                <span className="flex items-center tabular-nums">
                  {props.aheadCount}
                  <ArrowUpIcon aria-hidden />
                </span>
              ) : null}
            </>
          ) : (
            <>
              <CloudUploadIcon aria-hidden />
              Publish branch
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}

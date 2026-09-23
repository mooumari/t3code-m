import type { GitDashboardWorktree } from "@t3tools/contracts";
import { FolderGit2Icon, FolderIcon } from "lucide-react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Names the checkout on show: the project's own folder, or a separate worktree by its folder
 * name. Uses the composer's folder icons. Hover shows the full path; click copies it.
 */
export function GitCheckoutLabel(props: {
  readonly worktree: GitDashboardWorktree | undefined;
  readonly path: string;
}) {
  const { copyToClipboard } = useCopyToClipboard({
    onCopy: () => toastManager.add({ type: "success", title: "Path copied" }),
  });
  const isWorktree = props.worktree !== undefined && !props.worktree.isMain;
  const Icon = isWorktree ? FolderGit2Icon : FolderIcon;
  const label = isWorktree ? `Worktree · ${props.path.split("/").at(-1)}` : "Main checkout";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            className="min-w-0"
            aria-label={`${label}. Copy path`}
            onClick={() => copyToClipboard(props.path)}
          />
        }
      >
        <Icon aria-hidden />
        <span className="truncate">{label}</span>
      </TooltipTrigger>
      <TooltipPopup>
        <span className="font-mono">{props.path}</span>
        <span className="block text-muted-foreground">Click to copy</span>
      </TooltipPopup>
    </Tooltip>
  );
}

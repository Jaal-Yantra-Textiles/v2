import { Text } from "@medusajs/ui";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * #1113 — Figma-style layers panel over the moodboard canvas (admin twin of the
 * partner panel). Moodboard blocks are top-level Excalidraw frames, so "layers"
 * == the frame list. Each row jumps-to (scrollToContent), toggles visibility,
 * and locks. Excalidraw has no native hidden flag, so hide = opacity 0 + locked
 * (keeps an invisible frame non-interactive); show restores it. opacity/locked
 * are persisted in the moodboard JSON, so hidden state survives save/reload.
 */
type FrameRow = {
  id: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  hasContent: boolean;
};

const readFrames = (api: any): FrameRow[] => {
  const els = api.getSceneElements().filter((e: any) => !e.isDeleted);
  return els
    .filter((e: any) => e.type === "frame")
    .map((f: any) => ({
      id: f.id,
      name: f.name || "Untitled frame",
      hidden: (f.opacity ?? 100) === 0,
      locked: !!f.locked,
      hasContent: els.some((c: any) => c.frameId === f.id),
    }));
};

export function MoodboardLayersPanel({
  excalidrawAPI,
  tick,
  onClose,
}: {
  excalidrawAPI: any;
  tick: number;
  onClose: () => void;
}) {
  const [frames, setFrames] = useState<FrameRow[]>([]);
  const prevLockedRef = useRef<Record<string, boolean>>({});

  const refresh = useCallback(() => {
    if (!excalidrawAPI) {
      setFrames([]);
      return;
    }
    setFrames(readFrames(excalidrawAPI));
  }, [excalidrawAPI]);

  useEffect(() => {
    refresh();
  }, [refresh, tick]);

  const applyToFrame = useCallback(
    (frameId: string, patch: Record<string, any>) => {
      const api = excalidrawAPI;
      if (!api) return;
      const next = api.getSceneElements().map((el: any) =>
        el.id === frameId || el.frameId === frameId ? { ...el, ...patch } : el,
      );
      api.updateScene({ elements: next });
      refresh();
    },
    [excalidrawAPI, refresh],
  );

  const toggleHidden = useCallback(
    (f: FrameRow) => {
      if (!f.hidden) {
        prevLockedRef.current[f.id] = f.locked;
        applyToFrame(f.id, { opacity: 0, locked: true });
      } else {
        const prev = prevLockedRef.current[f.id] ?? false;
        delete prevLockedRef.current[f.id];
        applyToFrame(f.id, { opacity: 100, locked: prev });
      }
    },
    [applyToFrame],
  );

  const toggleLock = useCallback(
    (f: FrameRow) => applyToFrame(f.id, { locked: !f.locked }),
    [applyToFrame],
  );

  const jump = useCallback(
    (f: FrameRow) => {
      const api = excalidrawAPI;
      if (!api) return;
      const el = api.getSceneElements().find((e: any) => e.id === f.id);
      if (el) api.scrollToContent(el, { fitToContent: true, animate: true });
    },
    [excalidrawAPI],
  );

  return (
    <div className="rounded-lg border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ui-border-base">
        <Text size="small" weight="plus">
          Layers
        </Text>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={refresh}
            title="Refresh"
            className="px-1 text-ui-fg-muted hover:text-ui-fg-base"
          >
            ⟳
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="px-1 text-ui-fg-muted hover:text-ui-fg-base"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto py-1">
        {frames.length === 0 ? (
          <div className="px-3 py-4 text-ui-fg-muted text-sm">No frames yet.</div>
        ) : (
          frames.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-ui-bg-base-hover"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  f.hasContent ? "bg-ui-fg-interactive" : "bg-ui-border-base"
                }`}
                title={f.hasContent ? "Has content" : "Empty"}
              />
              <button
                type="button"
                onClick={() => jump(f)}
                title="Jump to frame"
                className={`flex-1 min-w-0 text-left text-sm truncate ${
                  f.hidden ? "text-ui-fg-muted line-through" : "text-ui-fg-base"
                }`}
              >
                {f.name}
              </button>
              <button
                type="button"
                onClick={() => toggleHidden(f)}
                title={f.hidden ? "Show" : "Hide"}
                className="text-sm leading-none opacity-80 hover:opacity-100"
              >
                {f.hidden ? "🚫" : "👁"}
              </button>
              <button
                type="button"
                onClick={() => toggleLock(f)}
                disabled={f.hidden}
                title={f.hidden ? "Locked while hidden" : f.locked ? "Unlock" : "Lock"}
                className="text-sm leading-none opacity-80 hover:opacity-100 disabled:opacity-30"
              >
                {f.locked ? "🔒" : "🔓"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

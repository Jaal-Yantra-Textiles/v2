// @ts-ignore - Excalidraw is an ESM module, dynamic import not feasible here
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Fragment, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useDesign,
  useGenerateMoodboard,
  useInsertMoodboardBlock,
  useMoodboardBlocks,
  useSeedMoodboard,
  type MoodboardBlockListing,
} from "../../hooks/api/designs";
import { RouteNonFocusModal } from "../modal/route-non-focus";
import { useMoodboard } from "../../hooks/use-moodboard";
import { Button, DropdownMenu, toast } from "@medusajs/ui";
import { FashionPanel } from "./fashion-panel";
import { MoodboardConstructionPicker } from "./moodboard-construction-picker";
import { MoodboardLayersPanel } from "./moodboard-layers-panel";

// Must match the frame name emitted by buildConstructionDetailsFrame on the
// backend, so re-inserting replaces the existing construction frame in place.
const CONSTRUCTION_FRAME_NAME = "4 · Construction details";

const genId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `el-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

/**
 * Re-id a block's elements (remapping frameId/containerId/boundElements) and
 * translate them by (dx, dy) so a drop-in never collides with existing ids.
 */
const reidAndTranslate = (elements: readonly any[], dx: number, dy: number): any[] => {
  const idMap = new Map<string, string>();
  elements.forEach((el) => idMap.set(el.id, genId()));
  return elements.map((el) => {
    const next: any = { ...el, id: idMap.get(el.id), x: (el.x ?? 0) + dx, y: (el.y ?? 0) + dy };
    if (el.frameId && idMap.has(el.frameId)) next.frameId = idMap.get(el.frameId);
    if (el.containerId && idMap.has(el.containerId)) next.containerId = idMap.get(el.containerId);
    if (Array.isArray(el.boundElements)) {
      next.boundElements = el.boundElements.map((b: any) =>
        b?.id && idMap.has(b.id) ? { ...b, id: idMap.get(b.id) } : b,
      );
    }
    return next;
  });
};

export function DesignMoodboardSection() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  
  const { design } = useDesign(id, { fields: ["moodboard"] });
  const navigate = useNavigate();
  
  // Function to close the modal
  const onClose = () => {
    console.log('Closing')
    navigate(-1);
  };
  
  const [fashionPanelOpen, setFashionPanelOpen] = useState(false);
  const [fashionPanelInitialTab, setFashionPanelInitialTab] = useState<string | undefined>(undefined);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  // Bumped on canvas change (only while the layers panel is open) so the panel
  // re-reads frames without re-rendering the editor on every pointer move.
  const [layersTick, setLayersTick] = useState(0);
  const layersOpenRef = useRef(false);
  useEffect(() => {
    layersOpenRef.current = layersOpen;
  }, [layersOpen]);

  const {
    isSaving,
    hasChanges,
    excalidrawAPIRef,
    handleSave,
    handleCloseSave,
    handleExcalidrawChange,
  } = useMoodboard({
    designId: id,
    onClose
  });

  const { mutate: generateMoodboard, isPending: isGenerating } =
    useGenerateMoodboard(id);
  const { mutateAsync: seedMoodboard } = useSeedMoodboard(id);
  const { data: blocksData } = useMoodboardBlocks(id);
  const { mutateAsync: insertBlock, isPending: isInserting } =
    useInsertMoodboardBlock(id);
  const [constructionOpen, setConstructionOpen] = useState(false);
  const didSeedRef = useRef(false);

  // Load a built scene straight into the canvas so it's editable immediately.
  const loadMoodboardIntoCanvas = useCallback((moodboard: any) => {
    const api = excalidrawAPIRef.current;
    if (!api || !moodboard) return;
    const files = moodboard.files ?? {};
    const fileList = Object.entries(files).map(([fid, f]: [string, any]) => ({
      id: fid,
      dataURL: f.dataURL,
      mimeType: f.mimeType || "image/png",
      created: f.created || Date.now(),
      lastRetrieved: Date.now(),
    }));
    if (fileList.length) api.addFiles(fileList as any);
    api.updateScene({
      elements: moodboard.elements,
      appState: { ...moodboard.appState, collaborators: new Map() },
    });
    api.scrollToContent(moodboard.elements, { fitToContent: true });
  }, [excalidrawAPIRef]);

  // Regenerate the tech-pack from the design's structured data (header/flats/
  // size-set/colorways + Construction specs). Persists server-side AND loads the
  // fresh scene straight into the canvas so it's editable immediately.
  const handleGenerate = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const proceed = window.confirm(
      "Generate the tech-pack from this design's specs? This replaces the current moodboard."
    );
    if (!proceed) return;

    toast.loading("Generating tech-pack…");
    generateMoodboard(undefined, {
      onSuccess: ({ moodboard }) => {
        loadMoodboardIntoCanvas(moodboard);
        toast.dismiss();
        toast.success("Tech-pack generated");
      },
      onError: (err: any) => {
        toast.dismiss();
        toast.error(err?.message || "Failed to generate tech-pack");
      },
    });
  }, [generateMoodboard, excalidrawAPIRef, loadMoodboardIntoCanvas]);

  // Auto-seed an empty board from the brief on open, so the admin lands on an
  // editable snapshot (Figma-style) instead of a blank canvas. Runs once; the
  // server only fills an empty board (merge-not-clobber) and is no-throw, so a
  // design with nothing to render yet is a silent no-op.
  useEffect(() => {
    if (didSeedRef.current || !design) return;
    const els = (design?.moodboard as any)?.elements;
    if (Array.isArray(els) && els.length > 0) {
      didSeedRef.current = true; // already populated — nothing to seed
      return;
    }
    didSeedRef.current = true;
    (async () => {
      try {
        const { moodboard } = await seedMoodboard();
        if (!moodboard) return;
        // Give Excalidraw a tick to finish mounting before pushing the scene.
        setTimeout(() => loadMoodboardIntoCanvas(moodboard), 60);
      } catch {
        // best-effort — auto-seed never blocks editing
      }
    })();
  }, [design, seedMoodboard, loadMoodboardIntoCanvas]);

  // The insert-block palette, grouped for the dropdown menu.
  const groupedBlocks = useMemo(() => {
    const blocks: MoodboardBlockListing[] = blocksData?.blocks ?? [];
    const order = ["Brief", "Tech-pack", "Workspace"];
    const byGroup: Record<string, MoodboardBlockListing[]> = {};
    for (const b of blocks) (byGroup[b.group] ??= []).push(b);
    return order.filter((g) => byGroup[g]?.length).map((g) => ({ group: g, items: byGroup[g] }));
  }, [blocksData]);

  // Drop one pre-filled block onto the canvas (re-id'd, placed right of existing
  // content). `replaceFrameNamed` strips an existing frame of that name first —
  // a "refresh this frame" used to re-render the construction glyph.
  const handleInsert = useCallback(
    async (key: string, label: string, replaceFrameNamed?: string) => {
      const api = excalidrawAPIRef.current;
      if (!api) return;
      try {
        const { block } = await insertBlock(key);
        const els = ((block as any)?.elements ?? []) as any[];
        if (!els.length) {
          toast.info(`Nothing to insert for "${label}" yet.`);
          return;
        }
        let existing = api.getSceneElements().filter((e: any) => !e.isDeleted);
        if (replaceFrameNamed) {
          const removeIds = new Set(
            existing
              .filter((e: any) => e.type === "frame" && e.name === replaceFrameNamed)
              .map((e: any) => e.id),
          );
          if (removeIds.size) {
            existing = existing.filter(
              (e: any) => !removeIds.has(e.id) && !removeIds.has(e.frameId),
            );
          }
        }
        let dx = 0;
        let dy = 0;
        if (existing.length) {
          const maxX = Math.max(...existing.map((e: any) => (e.x ?? 0) + (e.width ?? 0)));
          const minY = Math.min(...existing.map((e: any) => e.y ?? 0));
          dx = maxX + 120;
          dy = minY;
        }
        const placed = reidAndTranslate(els, dx, dy);
        const files = (block as any)?.files ?? {};
        const fileList = Object.entries(files).map(([fid, f]: [string, any]) => ({
          id: fid,
          dataURL: f.dataURL,
          mimeType: f.mimeType || "image/png",
          created: f.created || Date.now(),
          lastRetrieved: Date.now(),
        }));
        if (fileList.length) api.addFiles(fileList as any);
        api.updateScene({ elements: [...existing, ...placed] as any });
        api.scrollToContent(placed as any, { fitToContent: true });
        if (!replaceFrameNamed) toast.success(`Inserted "${label}"`);
      } catch (err: any) {
        toast.error(err?.message || "Failed to insert block");
      }
    },
    [insertBlock, excalidrawAPIRef],
  );

  const handleConstructionAdded = useCallback(() => {
    handleInsert("construction", "Construction details", CONSTRUCTION_FRAME_NAME);
  }, [handleInsert]);

  // Track when an image element is selected on the canvas
  const handleSelectionChange = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;

    const selected = api.getAppState()?.selectedElementIds || {};
    const selectedIds = Object.keys(selected).filter((k) => selected[k]);

    if (selectedIds.length === 1) {
      const elements = api.getSceneElements();
      const el = elements.find((e: any) => e.id === selectedIds[0]);
      if (el?.type === "image" && !el.isDeleted) {
        setSelectedImageId(el.id);
        return;
      }
    }
    setSelectedImageId(null);
  }, [excalidrawAPIRef]);

  // Open Fabric tab with the selected canvas image
  const handleUseForFabric = useCallback(() => {
    setFashionPanelInitialTab("fabric");
    setFashionPanelOpen(true);
  }, []);

  function getCanvasCenter() {
    const api = excalidrawAPIRef.current;
    if (!api) return { x: 0, y: 0 };
    const appState = api.getAppState();
    const { scrollX, scrollY, zoom, width, height } = appState as any;
    const zoomValue = typeof zoom === "object" ? zoom.value : zoom;
    return {
      x: (width / 2 - scrollX) / zoomValue,
      y: (height / 2 - scrollY) / zoomValue,
    };
  }

  return (
    <RouteNonFocusModal>
      <RouteNonFocusModal.Header onClick={handleCloseSave}>
        <div className="flex items-center justify-end w-full">
          <span className="text-ui-fg-muted text-sm">
            Insert · construction · generate · layers · save are in the canvas
            toolbar (top-right)
          </span>
        </div>
      </RouteNonFocusModal.Header>
      <RouteNonFocusModal.Body>
        <div className="relative h-[700px]">
          {fashionPanelOpen && (
            <div className="absolute top-14 right-2 z-50 w-72">
              <FashionPanel
                excalidrawAPI={excalidrawAPIRef.current}
                getCanvasCenter={getCanvasCenter}
                onClose={() => {
                  setFashionPanelOpen(false);
                  setFashionPanelInitialTab(undefined);
                }}
                initialTab={fashionPanelInitialTab}
              />
            </div>
          )}
          {layersOpen && (
            <div className="absolute top-14 left-2 z-50 w-64">
              <MoodboardLayersPanel
                excalidrawAPI={excalidrawAPIRef.current}
                tick={layersTick}
                onClose={() => setLayersOpen(false)}
              />
            </div>
          )}
          {/* Floating action when an image element is selected */}
          {selectedImageId && !fashionPanelOpen && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex gap-2">
              <button
                onClick={handleUseForFabric}
                className="rounded-full px-4 py-2 text-sm font-medium bg-ui-bg-base border border-ui-border-base shadow-elevation-flyout hover:bg-ui-bg-base-hover transition-colors"
              >
                🧵 Use for Fabric Preview
              </button>
              <button
                onClick={() => {
                  setFashionPanelInitialTab("fabric");
                  setFashionPanelOpen(true);
                }}
                className="rounded-full px-4 py-2 text-sm font-medium bg-ui-bg-base border border-ui-border-base shadow-elevation-flyout hover:bg-ui-bg-base-hover transition-colors"
              >
                🔍 3D Texture
              </button>
            </div>
          )}
          <Excalidraw
            excalidrawAPI={api => {
              excalidrawAPIRef.current = api;
              
              // Restore files if they exist
              const savedFiles = (design?.moodboard as any)?.files;
              if (savedFiles && Object.keys(savedFiles).length > 0) {
                // Create a simplified version of the files to restore
                const filesToRestore = Object.entries(savedFiles).map(([id, file]: [string, any]) => {
                  const raw = file.dataURL ?? ''
                  // Accept http(s) remote URLs and inline data: URIs (SVG, PNG, etc.)
                  const dataURL = raw.startsWith('http') || raw.startsWith('data:') ? raw : null;

                  return {
                    id,
                    dataURL: dataURL || 'placeholder',
                    mimeType: file.mimeType || 'image/png',
                    created: file.created || Date.now(),
                    lastRetrieved: Date.now()
                  };
                });
                
                // Add a small delay to ensure Excalidraw is fully initialized
                setTimeout(() => {
                  api.addFiles(filesToRestore as any);
                  
                  // Force a re-render to make sure elements reference the files correctly
                  const currentElements = api.getSceneElements();
                  const currentAppState = api.getAppState();
                  
                  // Update the scene with the restored files
                  api.updateScene({
                    elements: currentElements,
                    appState: currentAppState,
                  });
                }, 100);
              }
            }}
            initialData={{
              type: "excalidraw",
              version: 2,
              source: "https://excalidraw.com",
              elements: (design?.moodboard as any)?.elements ?? [],
              appState: {
                ...(design?.moodboard as any)?.appState,
                collaborators: new Map(),
              },
              files: (design?.moodboard as any)?.files ?? {}
            }}
            onChange={(elements, appState, files) => {
              handleExcalidrawChange(elements, appState, files);
              handleSelectionChange();
              if (layersOpenRef.current) setLayersTick((t) => t + 1);
            }}
            renderTopRightUI={() => (
              <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[62vw]">
                <DropdownMenu>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={isSaving || isInserting}
                      isLoading={isInserting}
                    >
                      Insert block
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    {groupedBlocks.length === 0 ? (
                      <DropdownMenu.Item disabled>No blocks available</DropdownMenu.Item>
                    ) : (
                      groupedBlocks.map((grp, gi) => (
                        <Fragment key={grp.group}>
                          {gi > 0 ? <DropdownMenu.Separator /> : null}
                          <DropdownMenu.Label>{grp.group}</DropdownMenu.Label>
                          {grp.items.map((b) => (
                            <DropdownMenu.Item
                              key={b.key}
                              // Brief blocks stay insertable even when empty —
                              // they drop an editable template you fill in place.
                              disabled={b.group !== "Brief" && !b.available}
                              onClick={() => handleInsert(b.key, b.label)}
                            >
                              {b.label}
                              {!b.available ? (
                                <span className="text-ui-fg-muted ml-1">· empty</span>
                              ) : null}
                            </DropdownMenu.Item>
                          ))}
                        </Fragment>
                      ))
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setConstructionOpen(true)}
                  disabled={isSaving}
                >
                  Add construction
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => handleGenerate()}
                  disabled={isGenerating || isSaving}
                  isLoading={isGenerating}
                >
                  Generate
                </Button>
                <Button
                  variant={layersOpen ? "primary" : "secondary"}
                  size="small"
                  onClick={() => setLayersOpen((v) => !v)}
                >
                  Layers
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setFashionPanelOpen((v) => !v)}
                >
                  Fashion Library
                </Button>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => handleSave()}
                  disabled={isSaving || !hasChanges}
                >
                  {isSaving ? "Saving..." : hasChanges ? "Save" : "No Changes"}
                </Button>
              </div>
            )}
            UIOptions={{
              canvasActions: {
                // Disable elements that may conflict with modal
                loadScene: true,
                export: { saveFileToDisk: true },
              },
            }}
            detectScroll={true}
            autoFocus={true}
          />
        </div>
      </RouteNonFocusModal.Body>

      <MoodboardConstructionPicker
        designId={id}
        open={constructionOpen}
        onOpenChange={setConstructionOpen}
        onAdded={handleConstructionAdded}
      />
    </RouteNonFocusModal>
  );
}
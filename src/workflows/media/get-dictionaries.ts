import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MEDIA_MODULE } from "../../modules/media"
import MediaService from "../../modules/media/service"

export type GetMediaDictionariesOutput = {
  folders: { id: string; name: string; slug?: string }[]
  albums: { id: string; name: string }[]
}

const listMediaDictionariesStep = createStep(
  "list-media-dictionaries-step",
  async (_: void, { container }) => {
    const service: MediaService = container.resolve(MEDIA_MODULE)

    const [folders, albums] = await Promise.all([
      service.listFolders({}, { select: ["id", "name", "slug"] }),
      service.listAlbums({}, { select: ["id", "name"] }),
    ])

    return new StepResponse<GetMediaDictionariesOutput>({
      folders: (folders || []).map((f: any) => ({ id: f.id, name: f.name, slug: f.slug })),
      albums: (albums || []).map((a: any) => ({ id: a.id, name: a.name })),
    })
  }
)

export const getMediaDictionariesWorkflow = createWorkflow(
  "get-media-dictionaries",
  () => {
    const dicts = listMediaDictionariesStep()
    return new WorkflowResponse(dicts)
  }
)

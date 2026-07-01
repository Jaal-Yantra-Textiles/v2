import {
  LoaderFunctionArgs,
  Outlet,
  UIMatch,
  useLoaderData,
  useParams,
} from "react-router-dom"
import { Container, Text } from "@medusajs/ui"
import { SingleColumnPageSkeleton } from "../../../components/table/skeleton"
import { useRawMaterialGroup } from "../../../hooks/api/raw-material-groups"
import {
  GroupGeneralSection,
  GroupColorsSection,
  GroupOrdersSection,
} from "../../../components/raw-material-groups/group-sections"
import { groupLoader } from "./loader"

const RawMaterialGroupDetailPage = () => {
  const { id } = useParams()
  const initialData = useLoaderData() as Awaited<ReturnType<typeof groupLoader>>
  const { data, isLoading } = useRawMaterialGroup(id)
  const group = data?.raw_material_group ?? initialData?.raw_material_group

  if (isLoading && !group) {
    return <SingleColumnPageSkeleton sections={3} />
  }

  if (!group) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-subtle">Group not found.</Text>
      </Container>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <GroupGeneralSection group={group} />
      <GroupColorsSection group={group} />
      <GroupOrdersSection groupId={group.id} />
      <Outlet />
    </div>
  )
}

export default RawMaterialGroupDetailPage

export async function loader({ params }: LoaderFunctionArgs) {
  return groupLoader({ params })
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const data = match.data as any
    return data?.raw_material_group?.name || "Group"
  },
}

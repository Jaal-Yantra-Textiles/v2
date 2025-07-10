
import { Heading } from "@medusajs/ui"
import { RouteDrawer } from '../../../components/modal/route-drawer/route-drawer'
import { PersonGeocodeContent } from "./geocode-component"

export const PersonGeocode = ({ personId }: { personId: string }) => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Geocode Addresses</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Geocode all addresses for this person
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <PersonGeocodeContent personId={personId} />
    </RouteDrawer>
  )
}
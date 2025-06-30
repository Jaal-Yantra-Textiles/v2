import { MapViewComponent } from "../../../components/maps/map-view-component";
import { RouteFocusModal } from "../../../components/modal/route-focus-modal";

const PersonMapView = () => {
  return (
    <RouteFocusModal>
      <MapViewComponent />
    </RouteFocusModal>
  );
};

export default PersonMapView;

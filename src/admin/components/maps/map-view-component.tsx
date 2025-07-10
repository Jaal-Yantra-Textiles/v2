import { Button, Container } from "@medusajs/ui"
import { usePersons } from "../../hooks/api/persons"
import { useEffect, useState } from "react"
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { RouteFocusModal } from "../modal/route-focus-modal";
import { PersonWithAddress } from "../../hooks/api/personandtype";

// Fix for default marker icon
let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow
});
L.Marker.prototype.options.icon = DefaultIcon;


interface MarkerData {
  position: [number, number];
  popup: string;
}

export const MapViewComponent = () => {
    const [offset, setOffset] = useState(0);
  const limit = 50;

  const { persons, isLoading, count } = usePersons({
    limit: limit,
    offset: offset,
    fields: "addresses.*,first_name,last_name,metadata.*",
  });

      const [markers, setMarkers] = useState<MarkerData[]>([]);

  useEffect(() => {
    if (!isLoading && persons) {
      const newMarkers = persons.flatMap((person) => {
        const p = person as unknown as PersonWithAddress;
        if (p.addresses && p.addresses.length > 0) {
          return p.addresses
            .filter((address) => address.latitude && address.longitude)
            .map((address) => ({
              position: [address.latitude, address.longitude] as [number, number],
                            popup: `<b>${p.first_name} ${p.last_name}</b><br>${address.street}, ${address.city}`,
            }));
        }
        return [];
      });

      setMarkers((prevMarkers) => {
        const existingPositions = new Set(prevMarkers.map(m => m.position.toString()));
        const uniqueNewMarkers = newMarkers.filter(m => !existingPositions.has(m.position.toString()));
        return [...prevMarkers, ...uniqueNewMarkers];
      });
    }
  }, [persons, isLoading]);

    const handleLoadMore = () => {
    setOffset(offset + limit);
  };

  return (
    <>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-2 px-2">
        <div className="flex w-full flex-1 flex-col gap-y-6 md:gap-y-8">
            
            <Container>
            {isLoading ? (
                <div>Loading map...</div>
            ) : (
                                <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: '800px', width: '100%' }}>
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                {markers.map((marker, idx) => (
                    <Marker key={idx} position={marker.position}>
                    <Popup>
                        <div dangerouslySetInnerHTML={{ __html: marker.popup }} />
                    </Popup>
                    </Marker>
                ))}
                </MapContainer>
            )}
            </Container>
        </div>
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer>
        <div className="flex items-center justify-between w-full">
          <div>
            <p>Showing {markers.length} of {count} persons</p>
          </div>
          <div className="flex items-center gap-x-2">
            <Button
              size="small"
              variant="secondary"
                            onClick={handleLoadMore}
              disabled={isLoading || (persons && persons.length === 0) || markers.length === count}
            >
              Load More
            </Button>
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Close
              </Button>
            </RouteFocusModal.Close>
          </div>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

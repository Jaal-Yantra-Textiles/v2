import { Button, Container, Heading } from "@medusajs/ui"
import { usePersons } from "../../hooks/api/persons"
import { useEffect, useState } from "react"
import { PersonWithAddress } from "../../hooks/api/personandtype";
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { RouteFocusModal } from "../modal/route-focus-modal";

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
  const { persons, isLoading } = usePersons({
    limit: 100, // Fetch a large number of persons
    offset: 0,
    fields: "addresses.*"
  });

  const [markers, setMarkers] = useState<MarkerData[]>([]);

  useEffect(() => {
    if (!isLoading && persons) {
      const allAddresses = persons.reduce((acc: any[], person: PersonWithAddress) => {
        if (person.addresses && person.addresses.length > 0) {
          return [...acc, ...person.addresses.map(a => ({...a, personName: `${person.first_name} ${person.last_name}`}))];
        }
        return acc;
      }, []);

      const geocodeAddresses = async () => {
        const newMarkers: MarkerData[] = [];
        for (const address of allAddresses) {
          const query = `$${address.postal_code}, ${address.country}`;
          try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (data && data.length > 0) {
              const { lat, lon } = data[0];
              newMarkers.push({
                position: [parseFloat(lat), parseFloat(lon)],
                popup: `<b>${address.personName}</b><br>${address.street}, ${address.city}`
              });
            }
          } catch (error) {
            console.error("Geocoding error:", error);
          }
        }
        setMarkers(newMarkers);
      };

      geocodeAddresses();
    }
  }, [persons, isLoading]);

  return (
    <>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 md:py-16 px-4 md:px-6">
        <div className="flex w-full max-w-[720px] flex-col gap-y-6 md:gap-y-8">
            <Heading>Persons Map View</Heading>
            <Container>
            {isLoading ? (
                <div>Loading map...</div>
            ) : (
                <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: '500px', width: '100%' }}>
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
        <div className="flex items-center justify-end w-full">
            <RouteFocusModal.Close asChild>
                <Button size="small" variant="secondary">
                    Close
                </Button>
            </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

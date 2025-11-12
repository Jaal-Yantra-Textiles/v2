import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Country coordinates (capital cities as reference points)
const COUNTRY_COORDINATES: Record<string, { lat: number; lng: number; name: string }> = {
  US: { lat: 38.9072, lng: -77.0369, name: 'United States' },
  GB: { lat: 51.5074, lng: -0.1278, name: 'United Kingdom' },
  CA: { lat: 45.4215, lng: -75.6972, name: 'Canada' },
  AU: { lat: -35.2809, lng: 149.1300, name: 'Australia' },
  DE: { lat: 52.5200, lng: 13.4050, name: 'Germany' },
  FR: { lat: 48.8566, lng: 2.3522, name: 'France' },
  IN: { lat: 28.6139, lng: 77.2090, name: 'India' },
  JP: { lat: 35.6762, lng: 139.6503, name: 'Japan' },
  CN: { lat: 39.9042, lng: 116.4074, name: 'China' },
  BR: { lat: -15.8267, lng: -47.9218, name: 'Brazil' },
  MX: { lat: 19.4326, lng: -99.1332, name: 'Mexico' },
  ES: { lat: 40.4168, lng: -3.7038, name: 'Spain' },
  IT: { lat: 41.9028, lng: 12.4964, name: 'Italy' },
  NL: { lat: 52.3676, lng: 4.9041, name: 'Netherlands' },
  SE: { lat: 59.3293, lng: 18.0686, name: 'Sweden' },
  NO: { lat: 59.9139, lng: 10.7522, name: 'Norway' },
  DK: { lat: 55.6761, lng: 12.5683, name: 'Denmark' },
  FI: { lat: 60.1699, lng: 24.9384, name: 'Finland' },
  PL: { lat: 52.2297, lng: 21.0122, name: 'Poland' },
  RU: { lat: 55.7558, lng: 37.6173, name: 'Russia' },
  KR: { lat: 37.5665, lng: 126.9780, name: 'South Korea' },
  SG: { lat: 1.3521, lng: 103.8198, name: 'Singapore' },
  HK: { lat: 22.3193, lng: 114.1694, name: 'Hong Kong' },
  TW: { lat: 25.0330, lng: 121.5654, name: 'Taiwan' },
  TH: { lat: 13.7563, lng: 100.5018, name: 'Thailand' },
  MY: { lat: 3.1390, lng: 101.6869, name: 'Malaysia' },
  ID: { lat: -6.2088, lng: 106.8456, name: 'Indonesia' },
  PH: { lat: 14.5995, lng: 120.9842, name: 'Philippines' },
  VN: { lat: 21.0285, lng: 105.8542, name: 'Vietnam' },
  NZ: { lat: -41.2865, lng: 174.7762, name: 'New Zealand' },
  ZA: { lat: -25.7479, lng: 28.2293, name: 'South Africa' },
  AE: { lat: 24.4539, lng: 54.3773, name: 'United Arab Emirates' },
  SA: { lat: 24.7136, lng: 46.6753, name: 'Saudi Arabia' },
  IL: { lat: 31.7683, lng: 35.2137, name: 'Israel' },
  TR: { lat: 39.9334, lng: 32.8597, name: 'Turkey' },
  GR: { lat: 37.9838, lng: 23.7275, name: 'Greece' },
  PT: { lat: 38.7223, lng: -9.1393, name: 'Portugal' },
  IE: { lat: 53.3498, lng: -6.2603, name: 'Ireland' },
  BE: { lat: 50.8503, lng: 4.3517, name: 'Belgium' },
  AT: { lat: 48.2082, lng: 16.3738, name: 'Austria' },
  CH: { lat: 46.9480, lng: 7.4474, name: 'Switzerland' },
  CZ: { lat: 50.0755, lng: 14.4378, name: 'Czech Republic' },
  HU: { lat: 47.4979, lng: 19.0402, name: 'Hungary' },
  RO: { lat: 44.4268, lng: 26.1025, name: 'Romania' },
  BG: { lat: 42.6977, lng: 23.3219, name: 'Bulgaria' },
  AR: { lat: -34.6037, lng: -58.3816, name: 'Argentina' },
  CL: { lat: -33.4489, lng: -70.6693, name: 'Chile' },
  CO: { lat: 4.7110, lng: -74.0721, name: 'Colombia' },
  PE: { lat: -12.0464, lng: -77.0428, name: 'Peru' },
  EG: { lat: 30.0444, lng: 31.2357, name: 'Egypt' },
  NG: { lat: 9.0765, lng: 7.3986, name: 'Nigeria' },
  KE: { lat: -1.2864, lng: 36.8172, name: 'Kenya' },
};

interface CountryData {
  country: string;
  visitors: number;
}

interface AnalyticsCountryMapProps {
  countriesData: CountryData[];
}

// Component to fit bounds when data changes
function FitBounds({ markers }: { markers: Array<{ position: [number, number] }> }) {
  const map = useMap();
  
  useEffect(() => {
    if (markers.length > 0) {
      const bounds = L.latLngBounds(markers.map(m => m.position));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 4 });
    }
  }, [markers, map]);
  
  return null;
}

export const AnalyticsCountryMap = ({ countriesData }: AnalyticsCountryMapProps) => {
  const mapRef = useRef<L.Map | null>(null);

  // Calculate max visitors for scaling circle sizes
  const maxVisitors = Math.max(...countriesData.map(d => d.visitors), 1);

  // Prepare markers data
  const markers = countriesData
    .filter(d => COUNTRY_COORDINATES[d.country])
    .map(d => {
      const coords = COUNTRY_COORDINATES[d.country];
      const radius = Math.max(5, (d.visitors / maxVisitors) * 30); // Scale between 5-30
      return {
        position: [coords.lat, coords.lng] as [number, number],
        country: coords.name,
        countryCode: d.country,
        visitors: d.visitors,
        radius,
      };
    });

  if (markers.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center bg-ui-bg-subtle rounded-lg">
        <p className="text-ui-fg-muted">No geographic data available</p>
      </div>
    );
  }

  return (
    <div className="h-[400px] rounded-lg overflow-hidden border border-ui-border-base">
      <MapContainer
        center={[20, 0]}
        zoom={2}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds markers={markers} />
        {markers.map((marker, index) => (
          <CircleMarker
            key={`${marker.countryCode}-${index}`}
            center={marker.position}
            radius={marker.radius}
            pathOptions={{
              fillColor: '#3b82f6',
              fillOpacity: 0.6,
              color: '#1e40af',
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-sm">
                <strong>{marker.country}</strong>
                <br />
                Visitors: {marker.visitors.toLocaleString()}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
};

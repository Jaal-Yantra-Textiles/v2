import { useParams } from "react-router-dom"
import { PersonGeocode } from "../../../../components/persons/person-geocode/person-geocode"

const PersonGeocodePage = () => {
  const { id } = useParams()
  return <PersonGeocode personId={id!} />
}

export default PersonGeocodePage

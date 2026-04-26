import { LinkDesignPartnerForm } from "../../../../components/forms/link-design-partner/link-design-partner-form"
import { useParams } from "react-router-dom"

const LinkDesignPartnerPage = () => {
    const { id } = useParams()
    return (
        <LinkDesignPartnerForm designId={id!} />
    )
}

export default LinkDesignPartnerPage
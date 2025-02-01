import { MedusaContainer } from "@medusajs/framework"

export const reFetchPartner = async (
    partnerId: string,
    container: MedusaContainer,
) => {
    const query = container.resolve("query")
    const { data: partner } = await query.graph({
        entity: "partners",
        filters: {
            id: partnerId
        },
        fields: ["*", "people.*" ]
    })
    return partner[0]
}
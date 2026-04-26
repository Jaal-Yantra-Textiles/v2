import { MedusaService } from "@medusajs/framework/utils"
import Note from "./models/note"

class NoteService extends MedusaService({
    Note,
}) {
    constructor() {
        super(...arguments)
    }

}

export default NoteService
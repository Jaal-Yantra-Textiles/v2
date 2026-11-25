import { MedusaService } from "@medusajs/framework/utils"
import Note from "./models/note"
import WorkNote from "./models/work-note"

class NoteService extends MedusaService({
    Note,
    WorkNote,
}) {
    constructor() {
        super(...arguments)
    }

}

export default NoteService

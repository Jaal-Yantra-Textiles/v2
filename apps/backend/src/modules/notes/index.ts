import { Module } from "@medusajs/framework/utils"
import NoteService from "./service"

export const NOTE_MODULE = "notes";


const NoteModule = Module(NOTE_MODULE,{
  service: NoteService
})

export { NoteModule }

export default NoteModule

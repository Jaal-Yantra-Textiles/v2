import { MedusaContainer } from "@medusajs/framework/types"

export interface InboundEmailRecord {
  id: string
  imap_uid: string
  message_id: string | null
  from_address: string
  to_addresses: string[]
  subject: string
  html_body: string
  text_body: string | null
  folder: string
  received_at: Date
  status: string
  action_type: string | null
  action_result: Record<string, unknown> | null
  extracted_data: Record<string, unknown> | null
  error_message: string | null
  metadata: Record<string, unknown> | null
}

export interface InboundEmailAction {
  type: string
  label: string
  description: string
  extract(email: InboundEmailRecord): Promise<any>
  execute(
    email: InboundEmailRecord,
    extractedData: any,
    params: any,
    container: MedusaContainer
  ): Promise<any>
}

const actionRegistry = new Map<string, InboundEmailAction>()

export function registerAction(action: InboundEmailAction): void {
  actionRegistry.set(action.type, action)
}

export function getAction(type: string): InboundEmailAction | undefined {
  return actionRegistry.get(type)
}

export function listActions(): InboundEmailAction[] {
  return Array.from(actionRegistry.values())
}

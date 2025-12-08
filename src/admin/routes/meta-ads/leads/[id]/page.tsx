import { 
  Container, 
  Heading, 
  Text, 
  StatusBadge, 
  Button,
  toast,
  usePrompt,
  Avatar,
  Textarea,
  Select,
  Label,
  Input,
} from "@medusajs/ui"
import { useParams, useNavigate, UIMatch, LoaderFunctionArgs } from "react-router-dom"
import { 
  useLead, 
  useUpdateLead,
  useDeleteLead,
  Lead,
  LeadStatus,
} from "../../../../hooks/api/meta-ads"
import { 
  Trash,
  CheckCircleSolid,
  EnvelopeSolid,
  Phone,
  BuildingStorefront,
  Map,
} from "@medusajs/icons"
import { TwoColumnPage } from "../../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton"
import { ActionMenu } from "../../../../components/common/action-menu"
import { useState } from "react"

// ============ Helper Functions ============

const getStatusBadgeColor = (status: LeadStatus): "green" | "orange" | "blue" | "red" | "grey" | "purple" => {
  switch (status) {
    case "new": return "blue"
    case "contacted": return "orange"
    case "qualified": return "purple"
    case "unqualified": return "grey"
    case "converted": return "green"
    case "lost": return "red"
    case "archived": return "grey"
    default: return "grey"
  }
}

const statusOptions: { label: string; value: LeadStatus }[] = [
  { label: "New", value: "new" },
  { label: "Contacted", value: "contacted" },
  { label: "Qualified", value: "qualified" },
  { label: "Unqualified", value: "unqualified" },
  { label: "Converted", value: "converted" },
  { label: "Lost", value: "lost" },
  { label: "Archived", value: "archived" },
]

// ============ Section Components ============

type LeadGeneralSectionProps = {
  lead: Lead
  onDelete: () => void
}

const LeadGeneralSection = ({ lead, onDelete }: LeadGeneralSectionProps) => {
  const prompt = usePrompt()
  
  const displayName = lead.full_name || 
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") || 
    lead.email || 
    "Unknown Lead"
  
  const handleDelete = async () => {
    const confirmed = await prompt({
      title: "Archive Lead",
      description: "Are you sure you want to archive this lead?",
      confirmText: "Archive",
      cancelText: "Cancel",
    })
    if (confirmed) {
      onDelete()
    }
  }
  
  return (
    <Container className="divide-y p-0">
      {/* Header with actions */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Avatar
            src={undefined}
            fallback={displayName.charAt(0).toUpperCase()}
          />
          <div>
            <div className="flex items-center gap-2">
              <Heading>{displayName}</Heading>
              <StatusBadge color={getStatusBadgeColor(lead.status)}>
                {lead.status.charAt(0).toUpperCase() + lead.status.slice(1)}
              </StatusBadge>
            </div>
            {lead.company_name && (
              <Text size="small" className="text-ui-fg-subtle">
                {lead.job_title ? `${lead.job_title} at ` : ""}{lead.company_name}
              </Text>
            )}
          </div>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Archive",
                  icon: <Trash />,
                  onClick: handleDelete,
                },
              ],
            },
          ]}
        />
      </div>
      
      {/* Contact Info */}
      {lead.email && (
        <div className="flex items-center gap-3 px-6 py-4">
          <EnvelopeSolid className="text-ui-fg-subtle" />
          <div>
            <Text size="small" className="text-ui-fg-subtle">Email</Text>
            <Text>{lead.email}</Text>
          </div>
        </div>
      )}
      
      {lead.phone && (
        <div className="flex items-center gap-3 px-6 py-4">
          <Phone className="text-ui-fg-subtle" />
          <div>
            <Text size="small" className="text-ui-fg-subtle">Phone</Text>
            <Text>{lead.phone}</Text>
          </div>
        </div>
      )}
      
      {lead.company_name && (
        <div className="flex items-center gap-3 px-6 py-4">
          <BuildingStorefront className="text-ui-fg-subtle" />
          <div>
            <Text size="small" className="text-ui-fg-subtle">Company</Text>
            <Text>{lead.company_name}</Text>
          </div>
        </div>
      )}
      
      {(lead.city || lead.state || lead.country) && (
        <div className="flex items-center gap-3 px-6 py-4">
          <Map className="text-ui-fg-subtle" />
          <div>
            <Text size="small" className="text-ui-fg-subtle">Location</Text>
            <Text>
              {[lead.city, lead.state, lead.country].filter(Boolean).join(", ")}
            </Text>
          </div>
        </div>
      )}
    </Container>
  )
}

type LeadSourceSectionProps = {
  lead: Lead
}

const LeadSourceSection = ({ lead }: LeadSourceSectionProps) => {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Source</Heading>
      </div>
      
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">Platform</Text>
        <Text size="small" leading="compact">{lead.source_platform || "—"}</Text>
      </div>
      
      {lead.campaign_name && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">Campaign</Text>
          <Text size="small" leading="compact">{lead.campaign_name}</Text>
        </div>
      )}
      
      {lead.adset_name && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">Ad Set</Text>
          <Text size="small" leading="compact">{lead.adset_name}</Text>
        </div>
      )}
      
      {lead.ad_name && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">Ad</Text>
          <Text size="small" leading="compact">{lead.ad_name}</Text>
        </div>
      )}
      
      {lead.form_name && (
        <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">Form</Text>
          <Text size="small" leading="compact">{lead.form_name}</Text>
        </div>
      )}
      
      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">Received</Text>
        <Text size="small" leading="compact">
          {new Date(lead.created_time).toLocaleString()}
        </Text>
      </div>
    </Container>
  )
}

type LeadFormDataSectionProps = {
  lead: Lead
}

const LeadFormDataSection = ({ lead }: LeadFormDataSectionProps) => {
  const fieldData = lead.field_data
  
  if (!fieldData || (Array.isArray(fieldData) && fieldData.length === 0)) {
    return null
  }
  
  // Handle both array format (from Meta) and object format
  const fields = Array.isArray(fieldData) 
    ? fieldData 
    : Object.entries(fieldData).map(([name, values]) => ({ name, values: Array.isArray(values) ? values : [values] }))
  
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Form Responses</Heading>
      </div>
      
      {fields.map((field: any, index: number) => (
        <div key={index} className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
          <Text size="small" leading="compact" weight="plus">
            {field.name?.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
          </Text>
          <Text size="small" leading="compact">
            {Array.isArray(field.values) ? field.values.join(", ") : String(field.values || "—")}
          </Text>
        </div>
      ))}
    </Container>
  )
}

type LeadActionsSectionProps = {
  lead: Lead
  onUpdate: (data: Partial<Lead>) => void
  isUpdating: boolean
}

const LeadActionsSection = ({ lead, onUpdate, isUpdating }: LeadActionsSectionProps) => {
  const [notes, setNotes] = useState(lead.notes || "")
  const [status, setStatus] = useState<LeadStatus>(lead.status)
  const [estimatedValue, setEstimatedValue] = useState(lead.estimated_value?.toString() || "")
  
  const handleSave = () => {
    const updates: Partial<Lead> = {}
    
    if (notes !== (lead.notes || "")) {
      updates.notes = notes
    }
    if (status !== lead.status) {
      updates.status = status
    }
    if (estimatedValue !== (lead.estimated_value?.toString() || "")) {
      updates.estimated_value = estimatedValue ? parseFloat(estimatedValue) : undefined
    }
    
    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }
  
  const hasChanges = 
    notes !== (lead.notes || "") || 
    status !== lead.status ||
    estimatedValue !== (lead.estimated_value?.toString() || "")
  
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Actions</Heading>
      </div>
      
      <div className="p-6 space-y-4">
        {/* Status */}
        <div>
          <Label htmlFor="status">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)}>
            <Select.Trigger>
              <Select.Value placeholder="Select status" />
            </Select.Trigger>
            <Select.Content>
              {statusOptions.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        
        {/* Estimated Value */}
        <div>
          <Label htmlFor="estimated_value">Estimated Value</Label>
          <Input
            id="estimated_value"
            type="number"
            placeholder="0.00"
            value={estimatedValue}
            onChange={(e) => setEstimatedValue(e.target.value)}
          />
        </div>
        
        {/* Notes */}
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            placeholder="Add notes about this lead..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
          />
        </div>
        
        {/* Save Button */}
        <Button
          variant="primary"
          className="w-full"
          onClick={handleSave}
          disabled={!hasChanges || isUpdating}
          isLoading={isUpdating}
        >
          Save Changes
        </Button>
      </div>
      
      {/* Status timestamps */}
      {lead.contacted_at && (
        <div className="px-6 py-3 bg-ui-bg-subtle">
          <Text size="small" className="text-ui-fg-subtle">
            Contacted: {new Date(lead.contacted_at).toLocaleString()}
          </Text>
        </div>
      )}
      {lead.qualified_at && (
        <div className="px-6 py-3 bg-ui-bg-subtle">
          <Text size="small" className="text-ui-fg-subtle">
            Qualified: {new Date(lead.qualified_at).toLocaleString()}
          </Text>
        </div>
      )}
      {lead.converted_at && (
        <div className="px-6 py-3 bg-ui-tag-green-bg">
          <div className="flex items-center gap-2">
            <CheckCircleSolid className="w-4 h-4 text-ui-tag-green-icon" />
            <Text size="small" className="text-ui-tag-green-text">
              Converted: {new Date(lead.converted_at).toLocaleString()}
            </Text>
          </div>
        </div>
      )}
    </Container>
  )
}

// ============ Main Page Component ============

const LeadDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  
  const { data: lead, isLoading, error } = useLead(id!)
  const updateMutation = useUpdateLead()
  const deleteMutation = useDeleteLead()
  
  if (isLoading) {
    return <TwoColumnPageSkeleton />
  }
  
  if (error || !lead) {
    return (
      <Container className="p-6">
        <Text className="text-ui-fg-error">
          {error?.message || "Lead not found"}
        </Text>
      </Container>
    )
  }
  
  const handleUpdate = async (data: Partial<Lead>) => {
    try {
      await updateMutation.mutateAsync({ id: id!, ...data } as any)
      toast.success("Lead updated")
    } catch (e: any) {
      toast.error(e.message || "Failed to update lead")
    }
  }
  
  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(id!)
      toast.success("Lead archived")
      navigate("/meta-ads/leads")
    } catch (e: any) {
      toast.error(e.message || "Failed to archive lead")
    }
  }
  
  return (
    <TwoColumnPage
      showJSON
      data={lead}
    >
      <TwoColumnPage.Main>
        <LeadGeneralSection 
          lead={lead}
          onDelete={handleDelete}
        />
        <LeadSourceSection lead={lead} />
        <LeadFormDataSection lead={lead} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <LeadActionsSection 
          lead={lead}
          onUpdate={handleUpdate}
          isUpdating={updateMutation.isPending}
        />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export default LeadDetailPage

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    return match.params.id || "Lead"
  },
}

export async function loader(args: LoaderFunctionArgs) {
  const { leadDetailLoader } = await import("./loader")
  return leadDetailLoader(args)
}

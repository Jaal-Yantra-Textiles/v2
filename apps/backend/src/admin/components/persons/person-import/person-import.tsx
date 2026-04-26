import { useState } from 'react'
import { Alert, Button, Heading, Text, toast } from "@medusajs/ui"
import { RouteDrawer } from '../../../components/modal/route-drawer/route-drawer'
import { useImportPersons, useConfirmImportPersons } from '../../../hooks/api/persons'
import { useRouteModal } from '../../modal/use-route-modal'
import { getPersonImportCsvTemplate } from './helpers/import-template'
import { FilePreview } from '../../common/file-preview'
import { UploadImport } from './upload-import'
import { ImportSummary } from './import-summary'

export const PersonImport = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Import Persons</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Import persons from a CSV file
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <PersonImportContent />
    </RouteDrawer>
  )
}

const PersonImportContent = () => {
  const [filename, setFilename] = useState<string>()
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')

  const { mutateAsync: importPersons, data } = useImportPersons()
  const { mutateAsync: confirm } = useConfirmImportPersons()
  const { handleSuccess } = useRouteModal()

  const personImportTemplateContent = getPersonImportCsvTemplate()

  const handleUploaded = async (file: File) => {
    setUploadedFile(file)
    setFilename(file.name)
    setErrorMessage('')
    
    try {
      await importPersons(
        { file },
        {
          onError: (err) => {
            setErrorMessage(err.message)
            // Don't clear the filename so we can still show the file
          },
        }
      )
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during import')
    }
  }

  const handleConfirm = async () => {
    if (!data?.transaction_id) {
      return
    }

    await confirm(data.transaction_id, {
      onSuccess: () => {
        toast.info("Success", {
          description: "Persons were successfully imported",
        })
        handleSuccess()
      },
      onError: (err) => {
        toast.error(err.message)
      },
    })
  }

  const handleRemoveFile = () => {
    setFilename(undefined)
    setUploadedFile(null)
    setErrorMessage('')
  }

  const retryImport = async () => {
    if (!uploadedFile) return
    await handleUploaded(uploadedFile)
  }

  return (
    <>
      <RouteDrawer.Body>
        <Heading level="h2">Upload CSV</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Upload a CSV file to import persons into your system
        </Text>

        <div className="mt-4">
          {filename ? (
            <div className="space-y-2">
              <FilePreview
                name={filename}
                size={uploadedFile?.size || 1024}
                onRemove={handleRemoveFile}
              />
              {errorMessage && (
                <Alert variant="error" title="Import failed">
                  <div className="space-y-2">
                    <Text>{errorMessage}</Text>
                    <Button size="small" variant="secondary" onClick={retryImport}>
                      Retry Import
                    </Button>
                  </div>
                </Alert>
              )}
            </div>
          ) : (
            <UploadImport onUploaded={handleUploaded} />
          )}
        </div>

        {data?.summary && !!filename && (
          <div className="mt-4">
            <ImportSummary summary={data?.summary} />
          </div>
        )}

        <Heading className="mt-6" level="h2">
          CSV Template
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Download a template with the required fields
        </Text>
        <div className="mt-4">
          <a 
            href={personImportTemplateContent} 
            download="person-import-template.csv"
            className="inline-block"
          >
            <FilePreview
              name="person-import-template.csv"
              size={1024} // Placeholder size
              onRemove={() => {}} // No-op for template
            />
          </a>
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button
            onClick={handleConfirm}
            size="small"
            disabled={!data?.transaction_id || !filename || !!errorMessage}
          >
            Import
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}

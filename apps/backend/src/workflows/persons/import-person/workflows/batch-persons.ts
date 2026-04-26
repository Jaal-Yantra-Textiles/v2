import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { GroupPersonsForBatchStepOutput } from "../steps/group-persons-for-batch"
import { PERSON_MODULE } from "../../../../modules/person"
import { PERSON_TYPE_MODULE } from "../../../../modules/persontype"
import PersonService from "../../../../modules/person/service"
import PersonTypeService from "../../../../modules/persontype/service"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"

export const batchPersonsWorkflowId = "batch-persons"
/**
 * This workflow creates and updates persons in batch.
 * 
 * @example
 * const result = await batchPersonsWorkflow(container).run({
 *   input: {
 *     create: [
 *       {
 *         first_name: "Jane",
 *         last_name: "Doe",
 *         email: "jane@example.com",
 *       }
 *     ],
 *     update: [
 *       {
 *         id: "per_123",
 *         first_name: "John",
 *         last_name: "Smith",
 *       }
 *     ]
 *   }
 * })
 */


export const batchPersonsStep = createStep(
  "batch-persons-step",
  async (input: GroupPersonsForBatchStepOutput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE)
    
    console.log(`Starting batch processing with ${input.create.length} records to create and ${input.update.length} to update`);
    
    // Process person creations
    const createPromises = input.create.map(async (personData) => {
      try {
        console.log(`Attempting to create person: ${personData.email}`);
        console.log('Person data:', JSON.stringify(personData, null, 2));
        const person = await personService.createPeople(personData)
        console.log(`Successfully created person with ID: ${person.id}`);
        
        // Process related entities if needed
        if (personData.addresses?.length) {
          // First check if this person already has addresses
          const existingAddresses = await personService.listAndCountAddresses({ person_id: person.id });
          console.log(`Found ${existingAddresses[1]} existing addresses for person ${person.id}`);
          
          // Create a map of existing addresses for quick lookup
          const existingAddressMap = new Map<string, boolean>();
          if (existingAddresses[0] && existingAddresses[0].length > 0) {
            existingAddresses[0].forEach((address: any) => {
              if (address) {
                // Create a composite key based on address properties
                const key = [
                  address.street || '',
                  address.city || '',
                  address.state || '',
                  address.postal_code || '',
                  address.country || ''
                ].join('|').toLowerCase();
                existingAddressMap.set(key, true);
              }
            });
          }
          
          // Process only unique addresses
          for (const addressData of personData.addresses) {
            // Create a composite key for this address
            const key = [
              addressData.street || '',
              addressData.city || '',
              addressData.state || '',
              addressData.postal_code || '',
              addressData.country || ''
            ].join('|').toLowerCase();
            
            // Skip if this address already exists
            if (existingAddressMap.has(key)) {
              console.log(`Skipping existing address: ${addressData.street}, ${addressData.city} for person: ${person.id}`);
              continue;
            }
            
            // Create the new address
            console.log(`Creating address: ${addressData.street}, ${addressData.city} for person: ${person.id}`);
            await personService.createAddresses({
              ...addressData,
              person_id: person.id,
            });
          }
        }
        
        if (personData.contact_details?.length) {
          // First check if this person already has contact details
          const existingContacts = await personService.listAndCountContactDetails({ person_id: person.id });
          console.log(`Found ${existingContacts[1]} existing contacts for person ${person.id}`);
          
          // Create a map of existing contact details for quick lookup
          const existingContactMap = new Map<string, boolean>();
          if (existingContacts[0] && existingContacts[0].length > 0) {
            existingContacts[0].forEach((contact: any) => {
              if (contact && contact.phone_number && typeof contact.phone_number === 'string') {
                // Use phone_number and type as a composite key
                const key = `${contact.phone_number}:${contact.type || ''}`;
                existingContactMap.set(key, true);
              }
            });
          }
          
          // Process only unique contact details
          for (const contactData of personData.contact_details) {
            if (contactData.phone_number) {
              // Create a composite key for this contact
              const key = `${contactData.phone_number}:${contactData.type || ''}`;
              
              // Skip if this contact already exists
              if (existingContactMap.has(key)) {
                console.log(`Skipping existing contact: ${contactData.phone_number} (${contactData.type}) for person: ${person.id}`);
                continue;
              }
              
              // Create the new contact
              console.log(`Creating contact: ${contactData.phone_number} (${contactData.type}) for person: ${person.id}`);
              await personService.createContactDetails({
                ...contactData,
                person_id: person.id,
              });
            }
          }
        }
        
        if (personData.tags?.length) {
          // First check if this person already has tags with these names
          const existingTags = await personService.listAndCountTags({ person_id: person.id });
          console.log(`Found ${existingTags[1]} existing tags for person ${person.id}`);
          
          // Create a map of existing tag names for quick lookup
          const existingTagNames = new Map<string, boolean>();
          if (existingTags[0] && existingTags[0].length > 0) {
            existingTags[0].forEach((tag: any) => {
              if (tag && tag.name && typeof tag.name === 'string') {
                existingTagNames.set(tag.name.toLowerCase(), true);
              }
            });
          }
          
          // Group new tags by name to avoid duplicates
          const uniqueTags = new Map();
          
          for (const tagData of personData.tags) {
            // Skip tags that already have an ID (they're already in the database)
            if (tagData.id) continue;
            
            // Only process tags with a name
            if (tagData.name) {
              const lowerName = typeof tagData.name === 'string' ? tagData.name.toLowerCase() : tagData.name;
              
              // Skip if this tag name already exists for this person
              if (existingTagNames.has(lowerName)) {
                console.log(`Skipping existing tag: ${tagData.name} for person: ${person.id}`);
                continue;
              }
              
              // Use the name as key to ensure uniqueness
              uniqueTags.set(lowerName, {
                name: tagData.name,
                person_id: person.id,
              });
            }
          }
          
          // Create only the unique tags
          for (const tag of uniqueTags.values()) {
            console.log(`Creating tag: ${tag.name} for person: ${person.id}`);
            await personService.createTags(tag);
          }
        }
        
        if (personData.person_types?.length) {
          console.log(`Processing ${personData.person_types.length} person types for person ${person.id}`);
          console.log('Person types data:', JSON.stringify(personData.person_types, null, 2));
          
          // Fetch all person types to get their IDs
          const personTypeService = container.resolve(PERSON_TYPE_MODULE) as PersonTypeService;
          
          // Extract type names for lookup
          const typeNames = personData.person_types
            .map(typeData => {
              if (typeof typeData === 'string') {
                console.log(`Type data is string: ${typeData}`);
                return typeData;
              }
              if (typeData && typeof typeData === 'object' && 'name' in typeData && typeData.name) {
                console.log(`Type data has name: ${typeData.name}`);
                return typeData.name;
              }
              if (typeData && typeof typeData === 'object' && 'id' in typeData && typeData.id) {
                console.log(`Type data has id: ${typeData.id}`);
                return null; // We don't need to look up by name if we have ID
              }
              console.log(`Unrecognized type data format: ${JSON.stringify(typeData)}`);
              return null;
            })
            .filter(Boolean)
            .map(name => name.toString());
          
          console.log(`Type names to look up: ${typeNames.join(', ')}`);
          
          // Fetch person types with names in our list
          let existingTypes: any[] = [];
          if (typeNames.length > 0) {
            const [types] = await personTypeService.listAndCountPersonTypes({
              name: typeNames
            });
            existingTypes = types;
            console.log(`Found ${existingTypes.length} existing person types:`, 
              JSON.stringify(existingTypes.map(t => ({ id: t.id, name: t.name })), null, 2));
          } else {
            console.log('No type names to look up');
          }
          
          // Create a map of type name to ID for easy lookup
          const typeNameToIdMap = new Map<string, string>();
          
          // Populate the map with type names (lowercase) to IDs
          for (const type of existingTypes) {
            if (type && type.name && type.id) {
              const key = type.name.toLowerCase();
              console.log(`Mapping ${key} to ${type.id}`);
              typeNameToIdMap.set(key, type.id);
            }
          }
          
          // Use the link service for person types
          const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
          const links: LinkDefinition[] = [];
          
          for (const typeData of personData.person_types) {
            // Handle different formats of person type data
            let typeId: string | undefined = undefined;
            let typeName: string | undefined = undefined;
            
            // Case 1: Type data is a string (just the type name)
            if (typeof typeData === 'string') {
              typeName = typeData;
              typeId = typeData ? typeNameToIdMap.get(typeData.toLowerCase()) : undefined;
            }
            // Case 2: Type data is an object with id
            else if (typeData && typeData.id) {
              typeId = typeData.id;
            }
            // Case 3: Type data is an object with name
            else if (typeData && typeData.name) {
              typeName = typeData.name;
              typeId = typeName ? typeNameToIdMap.get(typeName.toLowerCase()) : undefined;
            }
            
            // If we found a valid type ID, create the link
            if (typeId) {
              links.push({
                [PERSON_MODULE]: {
                  person_id: person.id
                },
                [PERSON_TYPE_MODULE]: {
                  person_type_id: typeId
                },
                data: {
                  person_id: person.id,
                  person_type_id: typeId
                }
              });
            } else if (typeName) {
              // Log that we couldn't find this person type
              console.log(`Warning: Could not find person type with name '${typeName}'`);
            }
          }
          
          if (links.length > 0) {
            await remoteLink.create(links as LinkDefinition[])
          }
        }
        
        return { success: true, id: person.id }
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          data: personData,
        }
      }
    })
    
    // Process person updates
    const updatePromises = input.update.map(async (personData) => {
      try {
        console.log(`Attempting to update person with ID: ${personData.id}`);
        console.log('Update data:', JSON.stringify(personData, null, 2));
        const { id, ...updateData } = personData
        
        // Validate state if present
        if (updateData.state) {
          const validStates = ["Onboarding", "Stalled", "Conflicted", "Onboarding Finished"];
          updateData.state = validStates.includes(updateData.state) ? updateData.state : "Onboarding";
        }
        
        console.log(`Normalized update data:`, JSON.stringify(updateData, null, 2));
        
        // Use appropriate selector for updating people
        await personService.updatePeople({
          selector: { id: id },
          data: updateData
        })
        
        // Process related entities if needed
        if (personData.addresses?.length) {
          // Find all addresses for this person
          const existingAddresses = await personService.listAddresses({ person_id: id })
          
          // Delete each address individually
          for (const address of existingAddresses) {
            await personService.deleteAddresses(address.id)
          }
          
          // Add new addresses
          for (const addressData of personData.addresses) {
            await personService.createAddresses({
              ...addressData,
              person_id: id,
            })
          }
        }
        
        if (personData.contact_details?.length) {
          // First find all contact details for this person
          const existingContacts = await personService.listContactDetails({ person_id: id })
          
          // Delete each contact individually
          for (const contact of existingContacts) {
            await personService.deleteContactDetails(contact.id)
          }
          
          // Add new contact details
          for (const contactData of personData.contact_details) {
            await personService.createContactDetails({
              ...contactData,
              person_id: id,
            })
          }
        }
        
        if (personData.tags?.length) {
          // First find all tags for this person
          const existingTags = await personService.listTags({ person_id: id })
          
          // Delete each tag individually
          for (const tag of existingTags) {
            await personService.deleteTags(tag.id)
          }
          
          // Add new tags
          for (const tagData of personData.tags) {
            // Check if the tag has a name property (new format) or value property (old format)
            const tagName = tagData.name || tagData.value;
            if (tagName) {
              // Create new tag and link to person
              await personService.createTags({
                name: tagName,
                person_id: id,
              })
            }
          }
        }

        if (personData.person_types?.length) {
          // Use the link service for person types as shown in associate-person-types workflow
          const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
          
          // We'll create new links without trying to fetch existing ones
          // The existing links will be overwritten by the new ones
          console.log(`Processing ${personData.person_types.length} person types for update of person ${id}`);
          
          // Create new links
          const links: LinkDefinition[] = []
          
          // Fetch person types service to look up types by name
          const personTypeService = container.resolve(PERSON_TYPE_MODULE) as PersonTypeService;
          
          // Extract all the type names from personData.person_types
          const typeNames = personData.person_types
            .map(typeData => {
              if (typeof typeData === 'string') {
                console.log(`Type data is string: ${typeData}`);
                return typeData;
              }
              if (typeData && typeof typeData === 'object' && 'name' in typeData && typeData.name) {
                console.log(`Type data has name: ${typeData.name}`);
                return typeData.name;
              }
              return null;
            })
            .filter(Boolean)
            .map(name => name.toString());
          
          console.log(`Type names to look up for update: ${typeNames.join(', ')}`);
          
          // Fetch person types with names in our list
          let existingTypes: any[] = [];
          if (typeNames.length > 0) {
            const [types] = await personTypeService.listAndCountPersonTypes({
              name: typeNames
            });
            existingTypes = types;
            console.log(`Found ${existingTypes.length} existing person types for update:`, 
              JSON.stringify(existingTypes.map(t => ({ id: t.id, name: t.name })), null, 2));
          }
          
          // Create a map of type name to ID for easy lookup
          const typeNameToIdMap = new Map<string, string>();
          
          // Populate the map with type names (lowercase) to IDs
          for (const type of existingTypes) {
            if (type && type.name && type.id) {
              const key = type.name.toLowerCase();
              console.log(`Mapping ${key} to ${type.id}`);
              typeNameToIdMap.set(key, type.id);
            }
          }
          
          // Process each person type
          for (const typeData of personData.person_types) {
            // Handle different formats of person type data
            let typeId: string | undefined = undefined;
            let typeName: string | undefined = undefined;
            
            // Case 1: Type data is a string (just the type name)
            if (typeof typeData === 'string') {
              typeName = typeData;
              typeId = typeData ? typeNameToIdMap.get(typeData.toLowerCase()) : undefined;
            }
            // Case 2: Type data is an object with id
            else if (typeData && typeData.id) {
              typeId = typeData.id;
            }
            // Case 3: Type data is an object with name
            else if (typeData && typeData.name) {
              typeName = typeData.name;
              typeId = typeName ? typeNameToIdMap.get(typeName.toLowerCase()) : undefined;
            }
            
            // If we found a valid type ID, create the link
            if (typeId) {
              links.push({
                [PERSON_MODULE]: {
                  person_id: id
                },
                [PERSON_TYPE_MODULE]: {
                  person_type_id: typeId
                },
                data: {
                  person_id: id,
                  person_type_id: typeId
                }
              });
            } else if (typeName) {
              // Log that we couldn't find this person type
              console.log(`Warning: Could not find person type with name '${typeName}' for update`);
            }
          }
          
          if (links.length > 0) {
            await remoteLink.create(links as LinkDefinition[])
          }
        }
        
        return { success: true, id }
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          data: personData,
        }
      }
    })
    
    const [createdResults, updatedResults] = await Promise.all([
      Promise.all(createPromises),
      Promise.all(updatePromises),
    ])
    
    console.log('Creation results:', JSON.stringify(createdResults, null, 2));
    console.log('Update results:', JSON.stringify(updatedResults, null, 2));
    
    return new StepResponse({
      created: createdResults,
      updated: updatedResults,
      stats: {
        created: createdResults.filter(r => r.success).length,
        createdFailed: createdResults.filter(r => !r.success).length,
        updated: updatedResults.filter(r => r.success).length,
        updatedFailed: updatedResults.filter(r => !r.success).length,
      },
    })
  }
)

/**
 * Main workflow for batch processing persons
 */
export const batchPersonsWorkflow = createWorkflow(
  batchPersonsWorkflowId,
  (input: WorkflowData<GroupPersonsForBatchStepOutput>) => {
    // Return the workflow response
    const batchPersons = batchPersonsStep(input);
    return new WorkflowResponse(batchPersons)
  }
)

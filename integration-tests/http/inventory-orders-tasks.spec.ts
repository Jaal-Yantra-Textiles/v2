import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(30000)

// Define test task templates
const inventoryCheckTemplate = {
  title: "Inventory Check Template",
  name: "Inventory Check Template",
  description: "Template for checking received inventory",
  priority: "high",
  estimated_duration: 120,
  required_fields: {
    "inventory_count": { type: "number", required: true },
    "quality_check": { type: "boolean", required: true },
    "notes": { type: "string", required: false }
  },
  eventable: true,
  notifiable: true,
  metadata: {
    type: "operations",
    department: "inventory"
  },
  category: "Inventory Management"
}

const supplierFollowUpTemplate = {
  title: "Supplier Follow-up Template",
  name: "Supplier Follow-up Template",
  description: "Template for following up with suppliers",
  priority: "medium",
  estimated_duration: 60,
  required_fields: {
    "supplier_id": { type: "string", required: true },
    "contact_method": { type: "enum", options: ["email", "phone", "in-person"], required: true },
    "follow_up_reason": { type: "string", required: true }
  },
  eventable: true,
  notifiable: true,
  metadata: {
    type: "communication",
    department: "procurement"
  },
  category: "Supplier Relations"
}

const qualityInspectionTemplate = {
  title: "Quality Inspection Template",
  name: "Quality Inspection Template",
  description: "Template for inspecting inventory quality",
  priority: "high",
  estimated_duration: 180,
  required_fields: {
    "inspection_type": { type: "enum", options: ["visual", "measurement", "functional"], required: true },
    "sample_size": { type: "number", required: true },
    "defect_threshold": { type: "number", required: true }
  },
  eventable: true,
  notifiable: true,
  metadata: {
    type: "quality",
    department: "quality_control"
  },
  category: "Quality Control"
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers
    let inventoryOrderId
    let inventoryItemId
    let stockLocationId
    let templateIds = {
      inventoryCheck: "",
      supplierFollowUp: "",
      qualityInspection: ""
    }
  
    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)
  
      // Create inventory item for the order
      const newInventory = {
        title: "Test Inventory Item",
        description: "Test Description",
      }
      const inventoryResponse = await api.post("/admin/inventory-items", newInventory, headers)
      expect(inventoryResponse.status).toBe(200)
      inventoryItemId = inventoryResponse.data.inventory_item.id
      
      // Create stock location
      const stockLocations = {
        name: 'Test Warehouse'
      }
      const stockLocationResponse = await api.post("/admin/stock-locations", stockLocations, headers)
      expect(stockLocationResponse.status).toBe(200)
      stockLocationId = stockLocationResponse.data.stock_location.id
      
      // Create inventory order
      const orderPayload = {
        order_lines: [
          { inventory_item_id: inventoryItemId, quantity: 5, price: 100 },
        ],
        quantity: 5,
        total_price: 500,
        status: "Pending",
        expected_delivery_date: new Date().toISOString(),
        order_date: new Date().toISOString(),
        shipping_address: {},
        stock_location_id: stockLocationId,
      }
      
      const orderResponse = await api.post("/admin/inventory-orders", orderPayload, headers)
      expect(orderResponse.status).toBe(201)
      inventoryOrderId = orderResponse.data.inventoryOrder.id

      // Create task templates
      const inventoryCheckResponse = await api.post("/admin/task-templates", inventoryCheckTemplate, headers)
      expect(inventoryCheckResponse.status).toBe(201)
      templateIds.inventoryCheck = inventoryCheckResponse.data.task_template.id
  
      const supplierFollowUpResponse = await api.post("/admin/task-templates", supplierFollowUpTemplate, headers)
      expect(supplierFollowUpResponse.status).toBe(201)
      templateIds.supplierFollowUp = supplierFollowUpResponse.data.task_template.id

      const qualityInspectionResponse = await api.post("/admin/task-templates", qualityInspectionTemplate, headers)
      expect(qualityInspectionResponse.status).toBe(201)
      templateIds.qualityInspection = qualityInspectionResponse.data.task_template.id
    })
  
    describe("POST /admin/inventory-orders/:id/tasks", () => {
      it("should create tasks from templates with template values", async () => {
        const response = await api.post(
          `/admin/inventory-orders/${inventoryOrderId}/tasks`,
          {
            type: "template",
            template_names: [inventoryCheckTemplate.name, qualityInspectionTemplate.name]
          },
          headers
        )
      
        expect(response.status).toBe(200)
        expect(response.data.taskLinks.count).toBe(2)
        expect(response.data.message).toContain(`Inventory Order ${inventoryOrderId} successfully created 2 tasks`)
  
        // Verify tasks were created with correct properties
        const tasksList = response.data.taskLinks.list
        expect(tasksList).toHaveLength(2)
        console.log(tasksList)
        // Check task properties
        const taskNames = tasksList.map(task => task.title)
        expect(taskNames).toContain(inventoryCheckTemplate.title)
        expect(taskNames).toContain(qualityInspectionTemplate.title)
      })

      it("should create a single task without template", async () => {
        const singleTaskData = {
          type: "task",
          title: "Manual Inventory Count",
          description: "Count inventory items manually",
          priority: "high",
          status: "pending",
          due_date: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
          estimated_duration: 60
        }
        
        const response = await api.post(
          `/admin/inventory-orders/${inventoryOrderId}/tasks`,
          singleTaskData,
          headers
        )
        
        expect(response.status).toBe(200)
        expect(response.data.taskLinks.count).toBe(1)
        
        const task = response.data.taskLinks.list[0]
        expect(task.title).toBe(singleTaskData.title)
        expect(task.description).toBe(singleTaskData.description)
        expect(task.priority).toBe(singleTaskData.priority)
        expect(task.status).toBe(singleTaskData.status)
      })
      
      it("should create parent-child tasks", async () => {
        const parentChildTaskData = {
          type: "task",
          title: "Inventory Processing Workflow",
            name: "Inventory Processing",
            description: "Process new inventory shipment",
            priority: "high",
            status: "pending",
            due_date: new Date(Date.now() + 172800000).toISOString(), // 2 days from now
            estimated_duration: 240,
          children: [
            {
              name: "Count Items",
              description: "Count all received items",
              priority: "high",
              status: "pending",
              estimated_duration: 60,
              title: "Count Items"
            },
            {
              name: "Quality Check",
              description: "Perform quality check on items",
              priority: "high",
              status: "pending",
              estimated_duration: 90,
              title: "Quality Check"
            },
            {
              name: "Update System",
              description: "Update inventory system with new counts",
              priority: "medium",
              status: "pending",
              estimated_duration: 30,
              title: "Update System"
            }
          ]
        }
        
        const response = await api.post(
          `/admin/inventory-orders/${inventoryOrderId}/tasks`,
          parentChildTaskData,
          headers
        )
        console.log("Parent child",response.data.taskLinks.list)
        expect(response.status).toBe(200)
        expect(response.data.taskLinks.count).toBe(1) // Only parent task is linked directly
        
        const parentTask = response.data.taskLinks.list[0]
        expect(parentTask.title).toBe(parentChildTaskData.title)
        expect(parentTask.description).toBe(parentChildTaskData.description)
        
        // We could add additional checks to verify children tasks were created
        // by fetching the parent task details, but that would require additional API calls
      })
    })
    
    describe("GET /admin/inventory-orders/:id/tasks", () => {
      it("should retrieve tasks for an inventory order", async () => {
        // First create some tasks
        await api.post(
          `/admin/inventory-orders/${inventoryOrderId}/tasks`,
          {
            type: "template",
            template_names: [inventoryCheckTemplate.name, supplierFollowUpTemplate.name]
          },
          headers
        )
        
        // Then retrieve them
        const response = await api.get(
          `/admin/inventory-orders/${inventoryOrderId}/tasks`,
          headers
        )
        expect(response.status).toBe(200)
        
        // The API returns an object with tasks
        expect(response.data).toBeInstanceOf(Object)
        
        // Check if the response has the expected structure
        const inventoryOrderData = response.data
        expect(inventoryOrderData).toBeDefined()
        expect(inventoryOrderData.tasks).toBeDefined()
        expect(inventoryOrderData.tasks.length).toBeGreaterThanOrEqual(2)
        
        // Verify task properties
        const tasks = inventoryOrderData.tasks
        const taskNames = tasks.map(task => task.title)
        expect(taskNames).toContain(inventoryCheckTemplate.title)
        expect(taskNames).toContain(supplierFollowUpTemplate.title)
      })
      
      it("should retrieve tasks with specific fields", async () => {
        // First create some tasks
        await api.post(
          `/admin/inventory-orders/${inventoryOrderId}/tasks`,
          {
            type: "task",
            title: "Field Test Task",
            description: "Testing field selection",
            priority: "medium",
            status: "pending",
            estimated_duration: 45
          },
          headers
        )
        
        // Then retrieve with specific fields
        const response = await api.get(
          `/admin/inventory-orders/${inventoryOrderId}/tasks?fields=id,title,status`,
          headers
        )
        
        expect(response.status).toBe(200)
        expect(response.data).toBeInstanceOf(Object)
        
        // Get the inventory order data from the response
        const inventoryOrderData = response.data
        expect(inventoryOrderData).toBeDefined()
        expect(inventoryOrderData.tasks).toBeDefined()
        console.log(inventoryOrderData.tasks)
        // Check that we only have the requested fields
        const task = inventoryOrderData.tasks.find(t => t.title === "Field Test Task")
        expect(task).toBeDefined()
        expect(task.id).toBeDefined()
        expect(task.title).toBe("Field Test Task")
        expect(task.status).toBe("pending")
        expect(task.description).toBeUndefined()
        expect(task.priority).toBeUndefined()
      })
      
      it("should return empty array for non-existent inventory order", async () => {
        const fakeId = "fake-inventory-order-id"
        
        try {
          await api.get(`/admin/inventory-orders/${fakeId}/tasks`, headers)
          // If we reach here, the test failed
          expect(true).toBe(false) // Force failure
        } catch (error) {
          expect(error.response.status).toBe(404)
          expect(error.response.data.message).toContain("not found")
        }
      })
    })
  }
})

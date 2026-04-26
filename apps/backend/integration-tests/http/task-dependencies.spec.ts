import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(30000)

const testDesign = {
    name: "Summer Collection 2025",
    description: "Lightweight summer wear collection",
    design_type: "Original",
    status: "Conceptual",
    priority: "High",
    target_completion_date: new Date("2025-06-30"),
    tags: ["summer", "casual", "lightweight"],
    metadata: {
        season: "Summer 2025",
        collection: "Coastal Breeze"
    }
}

// Task templates with dependencies
const researchTemplate = {
    name: "Research Template",
    description: "Template for market research tasks",
    priority: "high",
    estimated_duration: 120,
    required_fields: {
        "market_segment": { type: "string", required: true },
        "research_focus": { type: "string", required: true }
    },
    eventable: true,
    notifiable: true,
    metadata: {
        type: "research",
        department: "design"
    },
    category: "Market Research"
}

const designTemplate = {
    name: "Design Template",
    description: "Template for design creation tasks",
    priority: "high",
    estimated_duration: 240,
    required_fields: {
        "design_type": { type: "string", required: true },
        "target_market": { type: "string", required: true }
    },
    eventable: true,
    notifiable: true,
    metadata: {
        type: "design",
        department: "design"
    },
    category: "Design Creation"
}

const patternTemplate = {
    name: "Pattern Template",
    description: "Template for pattern making tasks",
    priority: "medium",
    estimated_duration: 180,
    required_fields: {
        "size_range": { type: "string", required: true },
        "complexity": { type: "string", required: true }
    },
    eventable: true,
    notifiable: true,
    metadata: {
        type: "technical",
        department: "pattern"
    },
    category: "Pattern Development"
}

setupSharedTestSuite(() => {
   
        let headers
        let designId
        let templateIds = {
            research: "",
            design: "",
            pattern: ""
        }
        const { api , getContainer } = getSharedTestEnv()
        beforeEach(async () => {
            const container = getContainer()
            await createAdminUser(container)
            headers = await getAuthHeaders(api)

            // Create design
            const designResponse = await api.post("/admin/designs", testDesign, headers)
            expect(designResponse.status).toBe(201)
            designId = designResponse.data.design.id

            // Create task templates
            const researchResponse = await api.post("/admin/task-templates", researchTemplate, headers)
            expect(researchResponse.status).toBe(201)
            templateIds.research = researchResponse.data.task_template.id

            const designResponse2 = await api.post("/admin/task-templates", designTemplate, headers)
            expect(designResponse2.status).toBe(201)
            templateIds.design = designResponse2.data.task_template.id

            const patternResponse = await api.post("/admin/task-templates", patternTemplate, headers)
            expect(patternResponse.status).toBe(201)
            templateIds.pattern = patternResponse.data.task_template.id
        })

        describe("POST /admin/designs/:id/tasks", () => {
            it("should create sequential dependent tasks from templates", async () => {
                const response = await api.post(
                    `/admin/designs/${designId}/tasks`,
                    {
                        type: "template",
                        template_names: [
                            researchTemplate.name,
                            designTemplate.name,
                            patternTemplate.name
                        ],
                        dependency_type: "blocking"
                    },
                    headers
                )

                expect(response.status).toBe(200)
                expect(response.data.taskLinks).toBeDefined()
                const tasks = response.data.taskLinks.list
                
                // Verify tasks were created in sequence
                expect(tasks).toHaveLength(3)

                // Find tasks by their template names
                const designTask = tasks.find(t => t.metadata.template_name === 'Design Template')
                const researchTask = tasks.find(t => t.metadata.template_name === 'Research Template')
                const patternTask = tasks.find(t => t.metadata.template_name === 'Pattern Template')

                expect(designTask).toBeDefined()
                expect(researchTask).toBeDefined()
                expect(patternTask).toBeDefined()

                // Verify Research Task (first in sequence)
                expect(researchTask.outgoing).toHaveLength(1)
                expect(researchTask.incoming).toHaveLength(0)
                expect(researchTask.outgoing[0]).toEqual(
                    expect.objectContaining({
                        dependency_type: 'blocking',
                        outgoing_task_id: researchTask.id,
                        incoming_task_id: designTask.id,
                        metadata: expect.objectContaining({
                            template_based: true,
                            template_ids: expect.any(Array)
                        })
                    })
                )

                // Verify Design Task (middle in sequence)
                expect(designTask.incoming).toHaveLength(1)
                expect(designTask.outgoing).toHaveLength(1)
                expect(designTask.incoming[0].outgoing_task_id).toBe(researchTask.id)
                expect(designTask.outgoing[0].incoming_task_id).toBe(patternTask.id)

                // Verify Pattern Task (last in sequence)
                expect(patternTask.incoming).toHaveLength(1)
                expect(patternTask.outgoing).toHaveLength(0)
                expect(patternTask.incoming[0].outgoing_task_id).toBe(designTask.id)
            })

            it("should create parent task with dependent child tasks", async () => {
                const response = await api.post(
                    `/admin/designs/${designId}/tasks`,
                    {
                        type: "template",
                        template_names: [researchTemplate.name],
                        child_tasks: [
                            {
                                title: "Market Analysis",
                                description: "Analyze target market",
                                priority: "high",
                                status: "pending",
                                dependency_type: "blocking"
                            },
                            {
                                title: "Trend Research",
                                description: "Research current trends",
                                priority: "medium",
                                status: "pending",
                                dependency_type: "blocking"
                            }
                        ]
                    },
                    headers
                )
                
                expect(response.status).toBe(200)
                expect(response.data.taskLinks).toBeDefined()
                const tasks = response.data.taskLinks.list
                expect(tasks).toHaveLength(1)

                // Verify parent task
                const parentTask = tasks[0]
                expect(parentTask.subtasks).toHaveLength(2)
                expect(parentTask.outgoing).toHaveLength(2)
                expect(parentTask.incoming).toHaveLength(0)

                // Verify parent task metadata
                expect(parentTask.metadata).toEqual(expect.objectContaining({
                    type: 'research',
                    department: 'design',
                    template_id: expect.any(String),
                    template_name: 'Research Template'
                }))

                // Verify dependencies between parent and children
                // Find subtasks by title instead of relying on array order
                const marketAnalysis = parentTask.subtasks.find(task => task.title === 'Market Analysis')
                const trendResearch = parentTask.subtasks.find(task => task.title === 'Trend Research')
                
                // Ensure both tasks were found
                expect(marketAnalysis).toBeDefined()
                expect(trendResearch).toBeDefined()

                // Verify Market Analysis task
                expect(marketAnalysis).toEqual(expect.objectContaining({
                    title: 'Market Analysis',
                    description: 'Analyze target market',
                    priority: 'high',
                    status: 'pending',
                    parent_task_id: parentTask.id
                }))

                // Verify Trend Research task
                expect(trendResearch).toEqual(expect.objectContaining({
                    title: 'Trend Research',
                    description: 'Research current trends',
                    priority: 'medium',
                    status: 'pending',
                    parent_task_id: parentTask.id
                }))

                // Verify outgoing dependencies from parent to children
                // Find dependencies by task ID instead of relying on array order
                const marketAnalysisDep = parentTask.outgoing.find(
                    dep => dep.incoming_task_id === marketAnalysis.id
                )
                const trendResearchDep = parentTask.outgoing.find(
                    dep => dep.incoming_task_id === trendResearch.id
                )
                
                // Ensure both dependencies were found
                expect(marketAnalysisDep).toBeDefined()
                expect(trendResearchDep).toBeDefined()
            
                // Use expect.objectContaining to match only the properties we care about
                // This allows the object to have additional properties like created_at, updated_at, and id
                expect(marketAnalysisDep).toEqual(expect.objectContaining({
                    dependency_type: 'subtask',
                    outgoing_task_id: parentTask.id,
                    incoming_task_id: marketAnalysis.id,
                    metadata: expect.objectContaining({
                        parent_child: true
                    })
                }))
                
                // Also use expect.objectContaining for the second dependency
                expect(trendResearchDep).toEqual(expect.objectContaining({
                    dependency_type: 'subtask',
                    outgoing_task_id: parentTask.id,
                    incoming_task_id: trendResearch.id,
                    metadata: expect.objectContaining({
                        parent_child: true
                    })
                }))
            })

            it("should prevent circular dependencies between tasks", async () => {
                // Create first set of tasks
                const response1 = await api.post(
                    `/admin/designs/${designId}/tasks`,
                    {
                        type: "template",
                        template_names: [researchTemplate.name, designTemplate.name],
                        dependency_type: "blocking"
                    },
                    headers
                )

                expect(response1.status).toBe(200)
                const tasks1 = response1.data.taskLinks.list

                // Try to create a task that would create a circular dependency
                try {
                    await api.post(
                        `/admin/designs/${designId}/tasks`,
                        {
                            type: "template",
                            template_names: [patternTemplate.name],
                            dependencies: {
                                incoming: [{
                                    task_id: tasks1[1].id,
                                    dependency_type: "blocking"
                                }],
                                outgoing: [{
                                    task_id: tasks1[0].id,
                                    dependency_type: "blocking"
                                }]
                            }
                        },
                        headers
                    )
                    
                } catch (error) {
                    expect(error.response.status).toBe(400)
                    expect(error.response.data.message).toContain('Circular dependency detected')
                }
            })
        })
})

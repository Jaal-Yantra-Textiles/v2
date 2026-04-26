/**
 * @file Partner API routes for managing tasks
 * @description Provides endpoints for creating, listing, and managing tasks in the JYT Commerce platform
 * @module API/Partners/Tasks
 */

/**
 * @typedef {Object} TaskInput
 * @property {string} title - The title of the task
 * @property {string} description - The description of the task
 * @property {string} status - The status of the task (pending, in_progress, completed, cancelled)
 * @property {string} priority - The priority of the task (low, medium, high)
 * @property {string} due_date - The due date of the task in ISO format
 * @property {string} partner_id - The ID of the partner associated with the task
 * @property {string} [assigned_to] - The ID of the user assigned to the task
 */

/**
 * @typedef {Object} TaskResponse
 * @property {string} id - The unique identifier of the task
 * @property {string} title - The title of the task
 * @property {string} description - The description of the task
 * @property {string} status - The status of the task
 * @property {string} priority - The priority of the task
 * @property {string} due_date - The due date of the task
 * @property {string} partner_id - The ID of the partner associated with the task
 * @property {string} assigned_to - The ID of the user assigned to the task
 * @property {Date} created_at - When the task was created
 * @property {Date} updated_at - When the task was last updated
 */

/**
 * @typedef {Object} TaskListResponse
 * @property {TaskResponse[]} tasks - The list of tasks
 * @property {number} count - The total number of tasks
 * @property {number} offset - The pagination offset
 * @property {number} limit - The number of items returned
 */

/**
 * Create a new task
 * @route POST /partners/tasks
 * @group Task - Operations related to tasks
 * @param {TaskInput} request.body.required - Task data to create
 * @returns {TaskResponse} 201 - Created task object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 *
 * @example request
 * POST /partners/tasks
 * {
 *   "title": "Design New Website",
 *   "description": "Create a new website design for the summer collection",
 *   "status": "pending",
 *   "priority": "high",
 *   "due_date": "2023-12-31T00:00:00Z",
 *   "partner_id": "partner_123456789",
 *   "assigned_to": "user_987654321"
 * }
 *
 * @example response 201
 * {
 *   "task": {
 *     "id": "task_123456789",
 *     "title": "Design New Website",
 *     "description": "Create a new website design for the summer collection",
 *     "status": "pending",
 *     "priority": "high",
 *     "due_date": "2023-12-31T00:00:00Z",
 *     "partner_id": "partner_123456789",
 *     "assigned_to": "user_987654321",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * List tasks with pagination
 * @route GET /partners/tasks
 * @group Task - Operations related to tasks
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=10] - Number of items to return
 * @param {string} [status] - Filter tasks by status
 * @param {string} [priority] - Filter tasks by priority
 * @param {string} [partner_id] - Filter tasks by partner ID
 * @returns {TaskListResponse} 200 - Paginated list of tasks
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * GET /partners/tasks?offset=0&limit=10&status=pending&priority=high
 *
 * @example response 200
 * {
 *   "tasks": [
 *     {
 *       "id": "task_123456789",
 *       "title": "Design New Website",
 *       "description": "Create a new website design for the summer collection",
 *       "status": "pending",
 *       "priority": "high",
 *       "due_date": "2023-12-31T00:00:00Z",
 *       "partner_id": "partner_123456789",
 *       "assigned_to": "user_987654321",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 50,
 *   "offset": 0,
 *   "limit": 10
 * }
 */

/**
 * Get a specific task by ID
 * @route GET /partners/tasks/{id}
 * @group Task - Operations related to tasks
 * @param {string} id.path.required - The ID of the task to retrieve
 * @returns {TaskResponse} 200 - Task object
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task not found
 *
 * @example request
 * GET /partners/tasks/task_123456789
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "task_123456789",
 *     "title": "Design New Website",
 *     "description": "Create a new website design for the summer collection",
 *     "status": "pending",
 *     "priority": "high",
 *     "due_date": "2023-12-31T00:00:00Z",
 *     "partner_id": "partner_123456789",
 *     "assigned_to": "user_987654321",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Update a task
 * @route PUT /partners/tasks/{id}
 * @group Task - Operations related to tasks
 * @param {string} id.path.required - The ID of the task to update
 * @param {TaskInput} request.body.required - Task data to update
 * @returns {TaskResponse} 200 - Updated task object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task not found
 *
 * @example request
 * PUT /partners/tasks/task_123456789
 * {
 *   "status": "in_progress",
 *   "assigned_to": "user_123456789"
 * }
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "task_123456789",
 *     "title": "Design New Website",
 *     "description": "Create a new website design for the summer collection",
 *     "status": "in_progress",
 *     "priority": "high",
 *     "due_date": "2023-12-31T00:00:00Z",
 *     "partner_id": "partner_123456789",
 *     "assigned_to": "user_123456789",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z"
 *   }
 * }
 */

/**
 * Delete a task
 * @route DELETE /partners/tasks/{id}
 * @group Task - Operations related to tasks
 * @param {string} id.path.required - The ID of the task to delete
 * @returns {Object} 200 - Success message
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task not found
 *
 * @example request
 * DELETE /partners/tasks/task_123456789
 *
 * @example response 200
 * {
 *   "message": "Task deleted successfully"
 * }
 */

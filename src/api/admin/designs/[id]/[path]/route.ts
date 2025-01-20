import { MedusaRequest, MedusaResponse } from "@medusajs/framework"


export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id, path } = req.params

 

  // Check if the path is for notes
  if (path === "notes") {
    
    return res.json({
      message: "Notes path handler",
      designId: id,
      path: path
    })
  }

  if (path === "test") {
    
    return res.json({
      message: "Test path handler",
      designId: id,
      path: path
    })
  }

  // Return 404 for unknown paths
  return res.status(404).json({
    message: `Path ${path} not found for design ${id}`
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id, path } = req.params

  if (path[0] === "notes") {
    console.log("Received POST request for notes path:", { 
      designId: id, 
      path,
      body: req.body 
    })
    return res.json({
      message: "Notes path handler - POST",
      designId: id,
      path: path
    })
  }

  return res.status(404).json({
    message: `Path ${path} not found for design ${id}`
  })
}


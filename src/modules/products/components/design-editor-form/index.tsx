"use client"

import { Button } from "@medusajs/ui"
import React, { useState } from "react"

const DesignEditorForm = () => {
  const [formData, setFormData] = useState({
    customName: "",
    buttonType: "Standard",
    material: "Cotton",
    color: "#ff0000",
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    console.log("Custom Design:", formData)
    // Here you would typically send the data to your backend
    alert("Design saved! Check the console for details.")
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-y-6">
      <div>
        <label htmlFor="customName" className="block text-sm font-medium text-gray-700">
          Custom Name
        </label>
        <input
          type="text"
          name="customName"
          id="customName"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="e.g., My Awesome Shirt"
          value={formData.customName}
          onChange={handleChange}
        />
      </div>

      <div>
        <label htmlFor="buttonType" className="block text-sm font-medium text-gray-700">
          Button Type
        </label>
        <select
          id="buttonType"
          name="buttonType"
          className="mt-1 block w-full rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
          value={formData.buttonType}
          onChange={handleChange}
        >
          <option>Standard</option>
          <option>Wooden</option>
          <option>Metallic</option>
        </select>
      </div>

      <div>
        <label htmlFor="material" className="block text-sm font-medium text-gray-700">
          Material
        </label>
        <select
          id="material"
          name="material"
          className="mt-1 block w-full rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
          value={formData.material}
          onChange={handleChange}
        >
          <option>Cotton</option>
          <option>Linen</option>
          <option>Polyester</option>
        </select>
      </div>

      <div>
        <label htmlFor="color" className="block text-sm font-medium text-gray-700">
          Color
        </label>
        <input
          type="color"
          name="color"
          id="color"
          value={formData.color}
          onChange={handleChange}
          className="mt-1 block w-full h-10 rounded-md border-gray-300 shadow-sm"
        />
      </div>

      <Button variant="primary" type="submit">
        Save Design
      </Button>
    </form>
  )
}

export default DesignEditorForm

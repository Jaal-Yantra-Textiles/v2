# Medo: Textile Production Workflow Platform

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/dv6ZSz?referralCode=qVdmfO)

[![Test and Release](https://github.com/Jaal-Yantra-Textiles/v2/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/Jaal-Yantra-Textiles/v2/actions/workflows/test-and-release.yml)

<p align="center">
  <img src="design.gif" alt="Medo Design Workflow" width="100%">
</p>

**A specialized, open-source platform built on [MedusaJS](https://docs.medusajs.com/) that unifies textile and garment production workflows from design to delivery.**

Medo streamlines communication and collaboration among textile designers, manufacturers, suppliers, and stakeholders—creating a single source of truth for your entire production pipeline.

## Overview

Textile and garment manufacturing involves numerous interconnected processes: design conceptualization, pattern making, material sourcing, dyeing, cutting, assembly, quality control, and distribution. Disconnected systems and communication gaps between these stages lead to inefficiencies, errors, and delayed deliveries.

Medo solves these challenges by bringing everyone in the textile production chain—**designers**, **pattern makers**, **suppliers**, **manufacturers**, **quality control**, and **distributors**—into a unified platform. Built on top of **MedusaJS**, Medo provides industry-specific tracking that follows each garment from concept to consumer.

> **TL;DR**: Medo is your single source of truth for tracking, automating, and managing the entire textile production lifecycle with unprecedented detail and visibility.

---

## Key Solutions

- Develop full fledged inventory lines with orders management 
- Integrated partner workflow where each individual partner can respond to individual tasks or orders
- Design creatives , store pre-production related images and mood boards
- Manage your personal/organizational relationship from single place.
- Track individual or complete steps of the designs with partner workflows.

---

## Why Choose Medo?

1. **Textile-Specific Workflows**: Purpose-built for the unique needs of textile and garment production
2. **End-to-End Traceability**: Follow each design from concept sketch to finished garment with detailed tracking
3. **Supply Chain Integration**: Connect designers, material suppliers, manufacturers, and distributors in one system
4. **Quality Control**: Built-in processes for textile-specific quality assurance and compliance
5. **Production Optimization**: Identify bottlenecks and inefficiencies with specialized metrics for textile manufacturing
6. **Extensible Architecture**: Thanks to MedusaJS, you can easily expand functionality to meet your specific production needs
7. **Partner Mobile App**: Empower your production partners to choose, start and finish tasks directly from their mobile devices for real-time visibility
8. **Integrated E-commerce**: As a designer, launch your own e-commerce store without the overhead of building and maintaining a separate website

---

## Getting Started

1. **Clone the Repository**  
   ```bash
   git clone https://github.com/Jaal-Yantra-Textiles/v2/
   ```

2. **Install Dependencies**  
   ```bash
   cd v2
   yarn install
   ```

3. **Set Up Environment**  
   - Copy `.env.template` to `.env`  
   - Fill in your database credentials and other required environment variables

4. **Run Migrations**  
   ```bash
   yarn medusa migrations run
   ```

5. **Start the Server**  
   ```bash
   yarn start
   ```
   Medo will be accessible on the configured port (e.g., `localhost:9000`)

---

## API Structure

Medo provides a comprehensive set of RESTful APIs:

- **/admin/task-templates**: Create and manage task templates and categories
- **/admin/tasks**: Handle task creation, assignment, and status updates
- **/admin/persons**: Manage stakeholders and their information
- **/admin/designs**: Track design and production processes
- **/admin/designs/[ID]/inventory**: Link and unlink inventory item for the use of the design.
- **/admin/designs/[ID]/tasks**: Link and unlink the tasks for the designs
- - Asssociate template tasks or independent tasks
- **/admin/editor-files**: List all files from the storage page wise.
- **/admin/inventory-items/[ID]/raw-materials**: Link Raw Materials per inventory item
- **/admin/inventory-orders**: Create inventory orders and track them through supply chain vertical with detailed tasks.
- **/admin/notes**: Store entity based notes such as design notes
- **/admin/oauth**: Internal oauth API to handle social media and other social logins for background purposes.
- **/admin/social-platform**: Manage social platforms and API configuration 
- **/admin/social-posts**: Manage, schedule social posts linked with Social Platforms.
- **/admin/users/(suspend/unsuspend)**: Suspend/Unsuspend another user 
- **/admin/websites**: Manage website content and blocks
- **/partners**: Partner-specific endpoints for task management
- **/categories**: Return system wide categories needed to display dropdown/select values.

All APIs follow consistent patterns with proper validation and error handling.

---

## Testing

We prioritize thorough testing to ensure reliability:

- **Integration Tests**: Validate that each module works correctly with real data flows
- **API Tests**: Confirm that all endpoints handle requests and responses properly
- **Workflow Tests**: Ensure complex business processes execute as expected

Run tests with:  
```bash
yarn test
```

---

## Contributing

We welcome community contributions. Whether you want to fix a bug, add a feature, or propose a new module, feel free to:

1. Fork this repo  
2. Create a new branch: `git checkout -b feature/new-module`  
3. Commit your changes: `git commit -m 'Add new module'`  
4. Push to the branch: `git push origin feature/new-module`  
5. Open a **Pull Request**

---

## License

Medo is released under the [MIT License](LICENSE). You're free to use, modify, and distribute this software for both commercial and non-commercial purposes.

---

## Contact

- **Issues & Requests**: Submit an [issue on GitHub](https://github.com/Jaal-Yantra-Textiles/v2/issues)  
- **Discussions**: Share your ideas or questions in [GitHub Discussions](https://github.com/Jaal-Yantra-Textiles/v2)  
- **Email**: info@medo.dev (for more detailed inquiries)

We're excited to see how you use Medo to optimize your workflows and processes. Stay tuned for more modules and updates!

**Start automating your textile workflows today!**
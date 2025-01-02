# Textile Production & Design Pipeline (TP/DP)

**A modern, open-source platform built on [MedusaJS](https://docs.medusajs.com/) to unify pre-production, production, and post-production workflows in the textile industry.**  
TPDP streamlines communication and collaboration between **designers**, **suppliers**, and **customers**—closing the loop on all stages of textile development and manufacturing.

## Overview

1. Label using this technology is reserved for [cicilabel(cicilabel)](https://cicilabel.com).

Textile manufacturing involves numerous moving parts: design specs, sourcing raw materials, dyeing, cutting, assembly, quality control, shipping, and more. Miscommunication and disconnected systems can lead to delays, errors, and added costs.

TPDP seeks to solve these challenges by bringing **all** stakeholders—**designers**, **suppliers**, **manufacturers**, **clients**, etc.—into a single, accessible platform. Built on top of **MedusaJS**, TPDP provides a modular approach that can be customized and extended to fit unique business processes.

> **TL;DR**: **TPDP** is your single source of truth for tracking and managing the life cycle of textile designs, from concept to consumer.

---

## Features

### 1. Person Module
Store and manage data for **suppliers**, **designers**, **vendors**, **logistics partners**, and more in one place.  
- Centralize **contact information**, **roles** (supplier, designer, etc.), and **metadata** about each stakeholder.  
- Maintain a complete address and contact history.  
- Flexible architecture allows for future enhancements like rating suppliers or tracking compliance information.

### 2. Design Module
Track the **pre-production** and **post-production** lifecycle of a design.  
- Create detailed records of **design specs**, **colors**, **materials**, and **planned timelines**.  
- Monitor **production stages**: from **dyeing**, **cutting**, **assembly**, to **final QA** and shipping.  
- View **movement of stocks** (raw materials to finished goods) in real-time.  
- Generate or import **technical packets** and **BOM (Bill of Materials)**.

### 3. Extensible Architecture (Powered by MedusaJS)
TPDP is modular by design:
- **MedusaJS** provides a robust foundation of APIs and service layers.
- You can easily add or remove modules (e.g., **Inventory**, **Sales**, **Finance**) to suit your workflow.
- Built-in **ORM** integrations, migrations, and advanced relationships support.

### 4. Roadmap & Coming Soon
- **Inventory & Stock Management**: Extended functionality to link Design with real-time warehouse data.  
- **Quality Control**: A module to log QC checks, defects, and related documentation.  
- **Collaborative Design Feedback**: Let clients comment on designs, request changes, and approve final specs.  
- **Analytics & Reporting**: Generate dashboards that track production milestones, supplier performance, and costs.

We plan to **launch a public beta** in **2–3 weeks**, but we’ll continue iterating on new modules and features based on community feedback.  

---

## Why TPDP?

1. **Closes the Gap** between pre-production (design, planning) and post-production (quality checks, distribution).  
2. **Unifies Communications** by keeping all parties’ data—**designers, suppliers, customers, and more**—within the same interface.  
3. **Flexible & Extendable** thanks to MedusaJS. Whether you’re a small design studio or a large-scale textile manufacturer, you can customize the modules to fit your operations.

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
   or
   ```bash
   npm install
   ```

3. **Set Up Environment**  
   - Copy `.env.template` to `.env`  
   - Fill in your database credentials and other required environment variables.

4. **Run Migrations**  
   ```bash
   yarn medusa migrations run
   ```
   This ensures your database schema is up-to-date for the Person and Design modules.

5. **Start the Server**  
   ```bash
   yarn start
   ```
   TPDP will be accessible on the configured port (e.g., `localhost:9000`).

---

## Integration Tests

We rely on **integration tests** to validate that each module (e.g., **Person** and **Design**) works correctly, from creating records to associating them.  

### Person Module Tests
- Ensures that **suppliers**, **designers**, and other stakeholder types can be created, retrieved, and updated.  
- Validates **relationships** (e.g., linking a Person to a specific design or production order).  

Run tests with:  
```bash
yarn test
```
*(We will soon provide a detailed test coverage report.)*

---

## Contributing

We welcome community contributions. Whether you want to fix a bug, add a feature, or propose a new module, feel free to:

1. Fork this repo.  
2. Create a new branch: `git checkout -b feature/new-module`  
3. Commit your changes: `git commit -m 'Add new module'`  
4. Push to the branch: `git push origin feature/new-module`  
5. Open a **Pull Request**.

---

## License

TPDP is released under the [MIT License](LICENSE). You’re free to use, modify, and distribute this software for both commercial and non-commercial purposes.

---

## Contact

- **Issues & Requests**: Submit an [issue on GitHub](https://github.com/Jaal-Yantra-Textiles/v2/issues).  
- **Discussions**: Share your ideas or questions in [GitHub Discussions](https://github.com/Jaal-Yantra-Textiles/v2).  
- **Email**: info@jaalyantra.com (for more detailed inquiries)

We’re excited to see how you use TPDP to optimize your textile pipeline—from pre-production concepts to post-production logistics. Stay tuned for more modules and updates as we approach our official launch! 

**Happy Designing & Producing!**
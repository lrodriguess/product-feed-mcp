Analyze this repository as one marketplace integration application. Focus only on how it captures, computes, synchronizes, and sends product-related information from VTEX to the external marketplace.

You are analyzing a VTEX marketplace integration repository.

Context:
This repository contains an application responsible for integrating VTEX with one specific external marketplace or sales channel. Each marketplace application is responsible for identifying which VTEX products are active for that channel and collecting the final product information needed to publish, update, or synchronize offers with the external channel.

The goal of this analysis is to document, in detail, how this application captures product information from VTEX from beginning to end.

Please analyze the repository code and produce a structured technical report explaining the full product data capture process, including discovery, enrichment, synchronization, and availability calculation.

Important:
Do not focus only on the happy path. Identify dependencies, fallback behaviors, retries, async processes, schedulers, queues, caches, event listeners, polling mechanisms, API calls, and error handling when present.

Please investigate and document the following:

1. General application purpose
- Which marketplace or external channel this application integrates with.
- What product-related responsibilities this application has.
- Whether it handles catalog, offer, price, inventory, logistics, availability, or order-related product data.
- Whether it only sends product data outward or also receives product/offer feedback from the marketplace.

2. Product discovery process
Explain how the application discovers which VTEX products/SKUs/offers should be processed for this marketplace.

Include:
- Entry points that start product synchronization.
- Whether the process starts from VTEX catalog data, trade policy, sales channel configuration, bindings, marketplace configuration, seller configuration, or another source.
- Whether products are discovered by scheduled jobs, manual triggers, events, queues, API requests, broadcaster notifications, or polling.
- How the application filters products that are active or eligible for the channel.
- How it identifies SKUs, products, sellers, sales channels, trade policies, or account/workspace context.
- Any rules that exclude products from synchronization.

3. Product data capture flow
Map the full flow used to collect the final product data from VTEX.

Include:
- Which internal VTEX APIs, modules, clients, services, SDKs, GraphQL queries, REST endpoints, or internal abstractions are used.
- Which data is collected from each source.
- Sequence of calls from the first trigger to the final product/offer payload.
- Any aggregation, transformation, normalization, mapping, or enrichment logic.
- Where the final marketplace payload is assembled.

Please identify the files, functions, classes, services, and methods involved.

4. Catalog and content data
Document how the application captures and prepares catalog/content information.

Include:
- Product ID, SKU ID, name, description, brand, category, specifications, attributes, images, EAN/GTIN, dimensions, variations, kit/bundle information, and seller information, when applicable.
- Attribute/category mapping logic between VTEX and the marketplace.
- Required vs optional fields.
- How missing or invalid catalog data is handled.
- Whether content is validated before being sent to the marketplace.

5. Price synchronization
Document in detail how price data is captured and synchronized.

Include:
- Which VTEX pricing APIs or services are used.
- Whether the application uses base price, fixed price, price tables, trade policy prices, simulation results, promotions, or marketplace-specific price rules.
- Whether taxes, discounts, list price, selling price, net price, or price by quantity are considered.
- How price is linked to SKU, seller, sales channel, trade policy, or marketplace account.
- Whether price changes are event-driven, scheduled, manually triggered, or detected by polling.
- How retries, failures, partial updates, and stale prices are handled.
- Whether price data is cached or persisted locally.

6. Inventory and availability synchronization
Document in detail how inventory and availability are captured and calculated.

Include:
- Which VTEX inventory, logistics, checkout, simulation, or availability APIs are used.
- Whether the application captures raw stock, available quantity, reserved quantity, safety stock, warehouse-level inventory, dock availability, SLA availability, or final sellable quantity.
- Whether availability is calculated directly from inventory or through checkout/logistics simulation.
- How the app determines if a SKU is available for the marketplace.
- How stock changes are detected.
- How out-of-stock, unavailable, inactive, blocked, or partially available SKUs are handled.
- Whether inventory data is cached or persisted locally.

7. Logistics and delivery data
Document how logistics and delivery information is collected and used.

Include:
- Which VTEX logistics APIs or modules are used.
- Whether the application captures shipping options, delivery SLAs, warehouse/dock data, lead time, pickup points, carrier information, shipping cost, delivery promise, or regional availability.
- Whether logistics information affects product availability, offer status, price, or marketplace payload.
- Whether logistics data is synchronized independently or only as part of offer/product synchronization.
- How missing or invalid logistics data is handled.

8. Synchronization architecture
Explain the broader synchronization architecture used by this application.

Include:
- Whether the process is synchronous or asynchronous.
- Whether it uses queues, workers, cron jobs, scheduled tasks, events, hooks, broadcaster notifications, or manual admin actions.
- Whether it has separate flows for catalog, price, stock, logistics, and availability.
- Whether there is a full sync and an incremental sync.
- Whether there are batch processes or single-SKU processes.
- How the app handles concurrency, rate limits, pagination, retries, and idempotency.
- Whether the app stores state locally, such as last sync date, sync status, marketplace offer ID, payload hash, error state, or mapping records.

9. Marketplace payload creation
Document how the application transforms VTEX product data into the external marketplace format.

Include:
- Where the final outbound payload is created.
- Which VTEX fields map to marketplace fields.
- Which marketplace-specific transformations are applied.
- Which validations happen before sending.
- Whether the same payload includes catalog, price, stock, logistics, and availability, or whether they are sent separately.
- Whether there are marketplace-specific constraints that influence how VTEX data is captured.

10. Error handling, observability, and supportability
Document how the application handles failures and exposes debugging information.

Include:
- Main failure points in the product data capture process.
- Error handling strategies.
- Retry logic.
- Dead-letter or failed-sync handling, if present.
- Logs, metrics, traces, admin screens, Bridge logs, or other observability mechanisms.
- How support teams or developers can understand why a product was not synchronized correctly.

11. Important dependencies and assumptions
Identify dependencies and assumptions in the current implementation.

Include:
- VTEX platform dependencies.
- Marketplace API dependencies.
- Required account or app settings.
- Required merchant configurations.
- Required sales channel, trade policy, logistics, pricing, catalog, or inventory configurations.
- Any hardcoded assumptions.
- Any coupling between this marketplace application and VTEX internal APIs.

12. End-to-end flow summary
At the end, produce a clear end-to-end summary of the product information capture process.

Please include:
- A numbered step-by-step flow from trigger to final marketplace update.
- A simple diagram in Mermaid syntax showing the main components and data flow.
- A table listing each type of information captured, its VTEX source, the code location, the transformation applied, and the destination in the marketplace payload.

Use this table format:

| Data type | VTEX source/API/module | Main files/functions | Transformation/business logic | Marketplace destination/use |
|---|---|---|---|---|
| Catalog/content |  |  |  |  |
| Price |  |  |  |  |
| Inventory/stock |  |  |  |  |
| Availability |  |  |  |  |
| Logistics/delivery |  |  |  |  |
| Mapping/state |  |  |  |  |

13. Code references
For every relevant finding, include code references:
- File path
- Function/class/method name
- Short explanation of what that code does
- Relevant call chain when possible

14. Output format
Please structure the final answer as a technical report with the following sections:

# Marketplace Product Data Capture Analysis

## 1. Executive summary
## 2. Application scope and marketplace responsibilities
## 3. Product discovery process
## 4. End-to-end product data capture flow
## 5. Catalog and content data
## 6. Price synchronization
## 7. Inventory and availability synchronization
## 8. Logistics and delivery synchronization
## 9. Synchronization architecture
## 10. Marketplace payload assembly
## 11. Error handling and observability
## 12. Dependencies, assumptions, and risks
## 13. Step-by-step flow
## 14. Mermaid diagram
## 15. Source-to-destination mapping table
## 16. Open questions and unclear areas in the code
## 17. Recommendations for what should be compared with other marketplace applications

Be precise and evidence-based. If something is not present in the code, say that it was not found. Do not infer behavior without pointing to the code that supports it.

After completing the analysis, create a Markdown file named {marketplace repo}-product-data-capture-analysis.md, adding the repo name in the curly brackets part, with the full report, and put the md in an existing folder "/Users/leonardorodrigues/Documents/GITHUB/product-feed-mcp"
# Enlistment Panel v2.19

## Operating model

The UBL internal enlistment file is the canonical product information source. `Target Platforms` and `Enlisted Platforms` are retained only inside the raw source JSON for audit; they do not create targets or update statuses.

Target accounts are selected manually in the Enlistment Panel. Each product/account pair has its own status, notes and optional account-specific fields.

## Import identity

Products are keyed by barcode where available. When barcode is absent, a normalized product-name key is used. Re-importing the same product refreshes product information but preserves account selection, statuses and account-specific fields.

## Export formats

### Regular
Used for every active account except Daraz and Pandamart.

- Sku Updated Perfect Name <- Name
- Brand <- Brand
- TP <- TP
- MRP <- MRP
- UBL CAT <- Category
- Description <- Product Description (Features)
- Updated Hero Image <- Image link

### Pandamart
Uses the 20-column Pandamart reference structure. `Dept` is exported as the reference-template constant `ABC`; `SubCategory` comes from the source; `Cart Limit` is left blank. Margin is normalized as `(MRP - TP) / MRP` when TP/MRP are available.

### Daraz
Uses the 20-column Daraz reference structure. Direct source mappings are used where available. Daraz-only fields are stored on the product/account target and remain editable:

- Product Weight
- New Shop SKU
- Daraz Seller SKU
- NEW SP
- NEW COGP override
- Supplier Code
- Product Type
- Reject before expiry days
- Alert before expiry days
- Offline before expiry days

When NEW COGP is not overridden, the export follows the reference workbook pattern `TP / 1.05`, rounded to 2 decimals.

## Status lifecycle

Supported statuses:

- Pending
- Ready
- Sent
- Under review
- Enlisted
- Needs correction
- Rejected

No status transition is automatic. Exporting a file writes export history only.

## Security

All enlistment tables have RLS enabled and no anon/authenticated grants. The Next.js server routes use the existing service-role admin client. The import RPC is SECURITY INVOKER and executable only by service_role.

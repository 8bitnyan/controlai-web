# Organization Spec

## Purpose

Defines invariants for the `Organization` model — in particular the shape and immutability of `Organization.slug`, which downstream features (notably managed daemon provisioning) rely on for derived URLs.

## Requirements

### Requirement: Organization slug is immutable

The `Organization.slug` column (already `String @unique`) SHALL be treated as immutable once set. No user-facing flow SHALL allow editing the slug after the organization is created.

#### Scenario: Slug edit attempt rejected

- **WHEN** any tRPC mutation attempts to update `Organization.slug` after creation
- **THEN** the mutation rejects with `BAD_REQUEST` and message "Organization slug is immutable"

#### Scenario: Slug surface for derived URLs

- **WHEN** the dashboard derives a managed-daemon `baseURL`
- **THEN** it SHALL read `Organization.slug` and combine it with the chosen env per the `instance-management` derivation rule

### Requirement: Slug shape validation

The system SHALL validate that `Organization.slug` matches `/^[a-z][a-z0-9-]{1,63}$/` at every write site (org creation, future imports). Existing rows that violate this shape SHALL be surfaced via an operator script, not silently accepted.

#### Scenario: Invalid slug at create time

- **WHEN** an org-creation flow receives a slug containing uppercase, leading digit, or symbols other than `-`
- **THEN** the mutation rejects with `BAD_REQUEST` and a message describing the allowed shape

#### Scenario: Defensive validation during provision

- **WHEN** `instance.provision` reads an existing `Organization.slug` and the value does not match the shape regex
- **THEN** the mutation rejects with `PRECONDITION_FAILED`
- **AND** no row is inserted and no provisioner call is made

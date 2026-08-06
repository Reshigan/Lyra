# ADR-0032: AES-256-GCM over WebCrypto for field-level encryption, not libsodium sealed boxes

## Status

Accepted, implemented.

## Context

docs/12 §1 says, verbatim:

> field-level encryption (libsodium sealed boxes, key in secret store) for
> national IDs and bank details; PANs never stored (PSP tokenization only).

Mapping where those values actually live gave a smaller surface than the
sentence suggests:

- `core_customers` stores `nationalIdHash` — a hash, never the number.
- `orbit_partners.payoutMethodRef` is a reference into the payout provider;
  `ledger_settlements` holds `externalRef`/`paidVia`. No IBAN or account number
  is stored anywhere in `packages/db/src`.
- PANs are never stored, per the same sentence and docs/19.

The one live gap was AXIS document extraction: the model reads an Emirates ID
number off a file and the route wrote it into `axis_documents.extraction_json`
in the clear, where every `GET /v1/axis/documents` returned it.

libsodium is the named mechanism and it is not a Workers-native dependency —
adding it means a wasm build plus a docs/02 §9 approval for a new third-party
library, in both homes (Workers and the on-prem container). WebCrypto is
already the whole of `packages/core/src/crypto.ts` and offers no
XSalsa20/XChaCha20-Poly1305, so there is no sealed box to build on it.

## Decision

1. **AES-256-GCM over WebCrypto**, in `packages/core/src/field-crypto.ts`. One
   implementation that runs unmodified on Workers, Node 22 and on-prem.
2. **Envelope:** `enc.v1.<base64url(iv‖ciphertext+tag)>`, 12-byte random IV per
   call. The same identifier sealed twice yields different ciphertext, so a
   column dump cannot be used to correlate rows by repeated value. GCM
   authenticates, so an edited ciphertext fails to open rather than decoding to
   garbage. The `v1` is there so a later scheme can be told apart per row.
3. **Key:** the `FIELD_KEY` wrangler secret (Docker env on-prem), widened to 32
   bytes with SHA-256. Not a KDF — the input is already high-entropy, there is
   no password to stretch. A deployment without `FIELD_KEY` fails the write
   (`fieldKey()` in `apps/api/src/env.ts`) rather than storing plaintext.
4. **What is sealed** is a field-name list, `SENSITIVE_EXTRACTION_FIELDS` in
   `packages/model-gateway/src/extract.ts`: `idNumber`, `iban`,
   `accountNumber`. By name, not by document type, so a future bank-statement
   type is covered the moment its field is named. `plateNumber` is deliberately
   absent: it identifies a vehicle, is printed on the outside of one, and every
   quote screen shows it.
5. **Sealing sits on the write path, not on one caller.** `resources.ts`
   `beforeWrite` seals `extractionJson` for the documents resource, so the
   human correcting a misread identifier through generic CRUD is covered as
   well as the extract route. Values that are already sealed pass through
   untouched, so a form round trip does not double-seal.
6. **Reading back is a door, not a mask.** Ordinary reads hand back the
   envelope — the ciphertext *is* the mask, so no `pii` map is needed on the
   resource. `POST /v1/axis/documents/:id/reveal` requires
   `axis:documents:read` **and** `core:pii:view`, and writes an audit row
   naming who opened it and which fields, never the values (docs/12 §2:
   "PII masked by default in UIs (reveal = permission + audit)").
7. **The UI shows a chip, not ciphertext.** `axis-doc-intel.tsx` renders a
   sealed field as "Hidden" with the reason on hover, and offers the reveal
   action only to an actor holding `core:pii:view`. Revealed plaintext lives in
   the action result for that one render — it is never written back into a form
   value or a loader, so a reload re-seals the screen and costs another audited
   reveal.

## Consequences

**What this trades away.** A sealed box is write-only at the edge: the public
key encrypts and cannot decrypt, so a compromised Worker can add identifiers
but not read the column. A symmetric key can do both. An attacker who obtains
the running Worker's secrets can decrypt the column with either scheme; the
difference is that sealed boxes would also have kept the *encrypting* half of
the system from reading, and that property is lost.

**Upgrade path if that matters.** X25519 ECDH to a per-tenant public key plus
AES-GCM for the payload reproduces the sealed-box property on WebCrypto
primitives, at the cost of a key-agreement step per write and a private key
held somewhere other than the edge. The `v1` in the envelope is what makes that
a later decision rather than a migration.

**Key rotation** is not built. Rotating `FIELD_KEY` today makes existing
envelopes unopenable; a rotation needs a key-id in the envelope and a re-seal
pass. Not required for go-live — noted so the next person does not discover it
during an incident.

**docs/12 §1 still names libsodium.** Per CLAUDE.md the spec wins unless a
decision records otherwise; this is that decision.

## Alternatives considered

- **libsodium-wrappers via wasm.** The literal spec. Rejected: a new
  third-party dependency in both homes, wasm in the Workers bundle, and a
  docs/02 §9 approval, to buy a property (write-only edge) that the key
  placement described above does not actually deliver without also moving the
  private key off the edge.
- **Encrypt the whole `extraction_json` blob.** Simpler, and wrong: the
  non-identifier fields are what the correction desk, the confidence meter and
  the eval scorer read. Sealing everything would make the row unusable without
  a reveal on every read.
- **A `pii` map on the documents resource (mask on read).** Masking is a
  presentation rule applied by the API to plaintext in the database. The
  requirement is that the column itself is worth nothing when dumped.

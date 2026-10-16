# Privacy setup, retention and recovery

This application implements privacy controls to support the operator's work under Russian personal-data law. It does **not** certify legal compliance, approve a provider, file a Roskomnadzor notification or replace legal/security review.

Start with [deployment launch gates](docs/DEPLOYMENT.md#production-launch-gates). The existing Netlify/Neon demonstration does not resolve Russian production data-location requirements.

## Terms used in the app

- **Operator:** the company or individual entrepreneur operating the shop and deciding why/how personal data is processed. A shop brand is not its legal identity.
- **Processor/contractor:** a party processing data under the operator's instructions, potentially including hosting and developer support.
- **Policy:** public information about processing, contacts, rights, recipients and retention.
- **Consent:** a separate affirmative choice for the optional guest name/comment.
- **Deletion journal:** minimal authenticated intentions kept independently of restorable database snapshots, so restoration does not resurrect erased content.

A privacy-policy link is not blanket consent. Necessary order processing and optional fields have separate purposes. Final wording, processing instructions, staff grounds and contractor arrangements require operator approval.

## Configure and publish documents

Use this sequence for a fresh database or an upgrade introducing migration `004_privacy.sql`:

1. Back up and rehearse migrations. They add privacy structures, mark historical consent unknown and preserve records. A legacy `updated_at` may become a labelled retention reference; it must not become a fabricated cooking-time event.
2. Create/recover the owner, then open `/owner/privacy` through **Персональные данные**.
3. In **Документы**, enter the operator's actual legal name, company/ИП type, INN, OGRN/OGRNIP, address and privacy-contact email.
4. Describe contractors, actual processing/storage/log/backup locations and staff-processing grounds. Leave unknown information blank until confirmed; do not derive it from the brand.
5. Review the generated policy and separate consent. Obtain the operator's approval of purposes, recipients, legal bases, rights handling and periods, including the proposed three-year evidence period.
6. Save the draft, review its saved version and publish with recent owner password confirmation.

Publishing requires complete fields, the current saved revision and approval. Published versions are immutable. Later edits create a draft; publication creates another version. Do not rewrite older published text that an order relied on.

**Without a published version, new ordering is blocked.** Existing-order fulfilment, tracking and accepted identical retries remain available. Publishing does not activate cleanup and is not permission to launch on unsuitable infrastructure.

## Checkout behaviour

Customers can order by number without name/comment consent. Optional text requires a separate, initially unchecked consent; unconsented text is rejected rather than silently discarded.

Checkout records the displayed notice version. Accepted optional-field consent records its purpose, immutable version and server timestamp transactionally with the order. No additional raw IP/fingerprint is collected merely as consent evidence.

A pending attempt freezes document versions together with the order and retry key. Accepted retries are checked before current policy/intake guards. Do not edit a pending payload to fit a newly published policy or erase historical consent evidence to make an old order appear newly consented.

Preparation comments must not request health information, payment data or another person's personal data. Special-category processing is outside this implementation's intended scope.

The policy also explains the staff session cookie, browser-local baskets/history and pending checkout storage. The application does not install advertising/visitor-analytics trackers. Assess any tracking introduced by a host or later integration separately; a generic “by using this site you agree” notice does not replace a required consent.

## Retention policy implemented by the app

Cleanup is **disabled until explicitly reviewed and activated**.

| Data | Implemented period/action |
| --- | --- |
| Guest name/comment and customer-identifying cancellation free text | Erase seven days after closure, including related audit copies |
| Individual receipt, item snapshots, events and original private-link/key mappings | Expire one calendar year after closure |
| Store/day/product totals and timing sums/sample counts | Preserve aggregate reporting after receipt expiry |
| Disabled staff identifying/contact fields | Scrub after 90 days; retain necessary actor references |
| Operational activity | Remove after one year |
| Security counters | Eligible after 23 hours; hourly scheduling should keep lifetime within 24 hours |
| Expired staff sessions | Security maintenance removes them |
| Minimal consent, request and destruction evidence | Proposed three-year period, subject to operator approval |
| Restricted database backups/restoration copies | Maximum 14-day lifetime must also be enforced outside the app |

New orders use actual terminal-status timestamps. Legacy retention references are labelled. Active orders are exempt from routine receipt/optional-field expiry.

Before removing a receipt, the transaction rolls up aggregate counts, values and timing sums/sample counts. Reports combine retained records and aggregates without counting twice. Historical timing samples remain missing rather than becoming zero/invented events.

Expired private links return 410. Minimal keyed replay markers prevent a very old request key creating a fresh order; they contain no customer order content or usable receipt mapping.

These are application policy choices, not a statement that every period is a statutory requirement.

## Prepare the independent deletion journal

Privacy erasure/correction/blocking and retention need:

- The business's original stable `SESSION_SECRET`.
- An absolute `PRIVACY_JOURNAL_PATH`.
- A protected writable journal outside database snapshots, frontend serving paths and Git.
- Independent restricted replication/backup and integrity monitoring for that journal.

The API writes and syncs a minimal authenticated intention before committing the database change. Entries contain record references, operation, reason, time and actor reference—not erased guest values, passwords, bearer tokens or checkout payloads.

A rolled-back intention can conservatively erase data during replay. A correction intentionally prevents the superseded value returning from backup. Losing/changing the signing key breaks journal verification and expiry/retry recognition.

The local file adapter is implemented. Remote durable storage/replication and production permissions are operational setup, not provisioned services.

### Docker configuration

`compose.privacy.yaml` is opt-in. Set `PRIVACY_JOURNAL_DIR` in local operational configuration to a **separate absolute host directory**. The override mounts it at `/privacy-journal` for API and CLI.

Prepare the directory/file with restricted permissions. On Linux, the API runs as uid/gid 10001; typical permissions are directory 700 and journal file 600, owned by that identity. Prepare only a new empty journal file; never truncate an existing one. On Windows, verify Docker bind access and host ACLs separately.

Add the override without dropping Vite from the normal development command:

```powershell
docker compose -f compose.yaml -f compose.vite.yaml -f compose.privacy.yaml --profile operations up -d --build api
```

API and maintenance must use the same live file and key. An ephemeral function `/tmp` directory is not an independent durable journal.

## Preview, activate and schedule cleanup

Preview first; it does not delete data:

```powershell
docker compose -f compose.yaml -f compose.privacy.yaml --profile operations run --rm privacy-maintenance -mode preview
```

Review overdue counts and historical references in **Сроки и очистка**. After journal/infrastructure setup and operator approval, explicitly activate retention in that owner screen with password confirmation.

Only then apply:

```powershell
docker compose -f compose.yaml -f compose.privacy.yaml --profile operations run --rm privacy-maintenance -mode apply -batch 200
```

One invocation processes bounded work. Repeat/drain until preview shows no overdue records. Schedule apply hourly on the future production scheduler, monitor failures/backlog, and compact the journal daily:

```powershell
docker compose -f compose.yaml -f compose.privacy.yaml --profile operations run --rm privacy-maintenance -mode compact
```

Batch size is 1–1000. Repeated runs are idempotent. A singleton maintenance lock prevents competing jobs; a separate replay lock coordinates with live checkout/status transactions. Waiting for live transactions does not mean another maintenance worker exists.

CLI equivalents, from `backend/` with the intended database URL, existing key and journal path exported:

```text
go run ./cmd/privacy-maintenance -mode preview
go run ./cmd/privacy-maintenance -mode apply -batch 200
go run ./cmd/privacy-maintenance -mode compact
```

The CLI does not load `.env`, migrate or activate cleanup. The standalone API's startup/hourly task only handles security housekeeping. Function cold starts are not a scheduler. Keep legacy `ORDER_RETENTION_DAYS=0`; its old deletion path is retired.

## Restore without resurrecting erased data

**Keep customer/staff traffic blocked throughout restoration.**

1. Select the intended business's restricted backup and verify its age/integrity.
2. Restore into the intended offline target, then apply missing migrations.
3. Supply the **current independent journal**, not one rolled back with the database, and the original key.
4. If the snapshot predates retention activation, restore reviewed activation through restricted administration while still offline.
5. Run restore mode:
   ```text
   privacy-maintenance -mode restore -batch 200
   ```
   Or, from `backend/`:
   ```text
   go run ./cmd/privacy-maintenance -mode restore -batch 200
   ```
6. Verify no overdue work remains, erased fields stay absent, expired links return 410 and aggregate reports match.
7. Reopen traffic only after those checks succeed.

Restore mode authenticates/replays the journal and drains overdue cleanup. It refuses missing/tampered journals or disabled retention. `-mode replay` alone is insufficient to reopen service.

An isolated dump/restore regression exists in `TestPrivacyBackupRestore`; it needs PostgreSQL client tools and a dedicated `TEST_DATABASE_URL`. Never rehearse by restoring over the live shop.

### Backups are separate from logical deletion

Apply the maximum lifetime to complete/incomplete dumps, provider snapshots, replicas, exports and restricted restoration copies. App erasure does not instantly erase WAL or physical backup media. Restrict and expire those copies as disclosed in the policy.

The Compose backup service prunes its files before attempts; it does not configure a provider's snapshot policy or encrypted off-machine expiry. Minimal journal/evidence and signed destruction acts follow their separate approved period and must not retain guest content.

## Handle a rights request

1. Receive correspondence through the operator's published contact.
2. Create a case under **Обращения** using store/order and request kind.
3. Keep correspondence/contact/passport details in the operator's restricted case process, not copied into this app's case record.
4. Verify identity proportionately: private link **plus purchase details**, in-person confirmation or an existing known contact. Possession of a public bearer link alone is not an export check.
5. With owner permission and recent password confirmation, verify the case and perform the appropriate export, block, correction or erasure.
6. Deliver the response securely outside the app and resolve the case.

Blocking hides disputed optional fields/free text from operational responses. Erasure does not cancel the order. Correction requires recorded consent and a still-valid purpose; erased fields cannot be restored by this workflow. Exports must not become permanent unprotected local copies.

Workers/managers cannot administer these cases. The application does not introduce passport uploads, verify identity automatically or send the operator's response.

## Destruction evidence

The retention screen exports a paginated destruction-log extract without erased values. It supports the operator's destruction records; it is not a signed statutory act or proof that all backup media have expired.

Responsible people must complete/sign the separate act, including the legally required identities, responsibilities and signatures. Retain the supporting log/act under the applicable approved period and restrict access. Do not confuse downloading the extract with completing the operator's procedure.

## Operator launch responsibilities

The operator must separately approve:

- A processing inventory: purposes, data categories, lawful bases, recipients, access and retention.
- Developer/hosting processing instructions and contractor agreements; a confidentiality sentence alone is insufficient.
- Russian data locations, backups, support access and any applicable transfer arrangements.
- Staff access/training, responsible persons, security assessment, device protection, monitoring and tested recovery.
- Required Roskomnadzor notifications/updates, a rights-response process and an incident contact.
- An incident procedure covering the applicable 24-hour initial and 72-hour investigation notification duties.

Accounting and statutory personnel archives remain in the operator's existing systems.

Legal reference points: [Article 6](https://www.consultant.ru/document/cons_doc_LAW_61801/315f051396c88f1e4f827ba3f2ae313d999a1873/), [Article 9](https://www.consultant.ru/document/cons_doc_LAW_61801/6c94959bc017ac80140621762d2ac59f6006b08c/), and the [official published law](https://mintrud.gov.ru/docs/laws/130) for localization, safeguards, notification and incident provisions. Final applicability and documents require operator/legal review.

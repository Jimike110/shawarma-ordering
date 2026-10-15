# Privacy setup and recovery

This is application preparation, not a compliance certificate. Netlify/Neon remain the existing demonstration setup; foreign Neon storage is not a Russian production solution. Do not collect real Russian customer/staff data until the operator has separately verified Russian processing/storage/log/backup locations and approved legal and security arrangements. No hosting move, production migration, notification or cleanup is performed by adding this code.

## Upgrade and publication

1. Take a restricted backup and rehearse migration `004_privacy.sql` in a disposable database. Deploy the frontend and API together. The migration adds structures, labels historical consent `unknown`, and uses existing `updated_at` only as a labelled legacy retention reference. It does not delete records or invent timing events. New intake starts blocked; existing order fulfilment, tracking and accepted retries remain available.
2. Bootstrap/recover the owner using the existing staff-admin procedure. Open **Owner → Overview → Персональные данные** (`/owner/privacy`). Enter the operator company's/ИП's actual details across all stores, privacy email, all processing contractors, actual infrastructure locations and staff-processing grounds. No shop-brand-to-legal-identity assumption is made.
3. Review the generated policy and the separate optional-data consent with the operator. Approve the purposes, recipients/assignments, retention periods and legal grounds, including the proposed three-year evidence period. Save the draft, confirm the owner password when asked, then publish. Publishing is immutable; editing creates a new draft. Retain earlier published versions as proof of displayed terms. An unsaved draft cannot be published.
4. Number-only orders need no optional-data consent. Names/comments need a separate unchecked checkbox; the server rejects unconsented text. New clients submit the displayed notice version; stale clients must refresh. Accepted retries keep their original payload and document version, including legacy fingerprints. Never rewrite a pending payload to fit a new document.

## Retention and separate journal

The owner must preview existing records and explicitly activate cleanup; migration/publication do not activate it. Actual terminal timestamps apply to new orders. Seven days after closure the optional name/comment and cancellation free text are erased, including audit copies. After one calendar year individual receipts/events and original key/link mappings expire; store/day aggregates and timing sums/sample counts remain. Active orders are exempt. Account identities/contact fields are scrubbed 90 days after disabling; actor references remain. Operational audit expires after a year; consent/request/destruction evidence after three years. Security counters are purged at 23 hours by an hourly job, allowing completion within 24 hours when the scheduler runs on time. Monitor failures and overdue counts.

Use a protected **absolute `PRIVACY_JOURNAL_PATH`**, outside restorable database snapshots and web-served directories. Keep `SESSION_SECRET` stable: it authenticates journal entries and keys expiry/throttling digests, as well as existing tracking-token derivation. Back it up separately with restricted access; losing/changing it breaks replay/expiry recognition. Do not store journal/key/operator-specific working copies in Git. Configure encrypted independent journal replication, restricted administrators, and integrity monitoring before production. This phase supplies a local durable-file adapter; a remote journal adapter and Russian infrastructure still require operational provisioning.

The API writes and syncs a minimal deletion intention **before** DB commit under a shared database advisory lock. It contains record references, operation/reason/time, actor reference and a keyed integrity tag, never guest values, passwords, tokens or checkout payloads. A rolled-back erasure intention can be replayed conservatively as erasure. Verified corrections intentionally erase superseded backup values on restoration instead of restoring old text. A missing/unwritable journal blocks privacy mutations. Keep a protected initially empty journal file even before the first deletion; never overwrite an existing file to initialize it.

For Docker, opt in with `compose.privacy.yaml` alongside your usual base/Vite files. Set `PRIVACY_JOURNAL_DIR` to a separate absolute host directory writable by uid 10001 and inaccessible to other users. On Linux, an administrator can prepare the **new** directory using `install -d -m 700 -o 10001 -g 10001 /srv/private/shop-journal`, then create the initially empty `deletions.jsonl` with mode 600/owner 10001. Do not include this directory in DB-volume snapshots or expose it to the frontend. The opt-in file is not applied automatically.

CLI examples (from `backend`, with the intended `DATABASE_URL`, existing `SESSION_SECRET` and journal path exported in the same terminal; Go does not load `.env`):

```text
go run ./cmd/privacy-maintenance -mode preview
go run ./cmd/privacy-maintenance -mode apply -batch 200
go run ./cmd/privacy-maintenance -mode compact
```

`preview` is the default and never changes data. `apply` requires owner activation and processes bounded transactions (1–1000 records). Run repeatedly until overdue counts are zero after activation; schedule hourly on the future production host and alert on failures. Run `compact` daily to discard authenticated journal entries older than three years. Database cleanup and receipt archival commit together; repetition cannot count a receipt twice. Concurrent jobs share an advisory lock. Never schedule deletion through Netlify cold starts. The standalone API only performs hourly session/counter cleanup; privacy cleanup is the explicit CLI job. Nonzero `ORDER_RETENTION_DAYS` is retired and refused by the standalone server.

With the Docker override, the corresponding preview command is:

```text
docker compose -f compose.yaml -f compose.privacy.yaml --profile operations run --rm privacy-maintenance -mode preview
```

Use `-mode apply -batch 200` in the hourly task and `-mode compact` in the daily task. The API and CLI must share the same live journal and secret. The scheduler should retry/drain bounded batches until the preview has no overdue work, not silently leave a backlog after one batch. This phase does not install a production scheduler.

## Restore gate and backups

Keep every database backup, incomplete dump, database replica/provider snapshot, order-data export and restricted restoration copy under a maximum **14-day backup lifetime**. Approved minimal consent/request/destruction evidence and signed acts follow their separate three-year period; they must not contain erased guest values. The local backup script prunes complete/incomplete dumps before each attempt; provider/off-machine expiry and encryption must be configured separately. Backups may temporarily contain erased fields; access is restricted and their expiry is disclosed in the published policy. Do not claim SQL logical deletion has already erased WAL, snapshots or physical storage. An independent journal copy follows its separate three-year minimal-evidence period, never restoration of an old DB snapshot.

**Keep the API/frontend inaccessible during restoration.** Restore only the intended business database, apply migrations, supply its existing live journal/key, then run:

```text
privacy-maintenance -mode restore -batch 200
```

This authenticates/replays journal intentions and drains overdue retention before reporting success. It refuses missing/tampered journals or disabled retention. Restore reviewed retention activation if the restored snapshot predates activation, while still offline. `replay` alone only replays the journal and is insufficient to open traffic. Verify the preview has zero overdue work, private links return 410 for expired receipts, erased fields remain absent, and analytics match before reconnecting the API. Do not run restoration against the live shop as a test. A genuine dump/restore + external-journal regression lives in `TestPrivacyBackupRestore` and requires PostgreSQL client tools against an isolated `TEST_DATABASE_URL`.

## Rights requests and destruction evidence

Accept requests at the published operator contact. Record the order/store and request kind in the privacy workspace without copying contact/message/passport details into it. Keep correspondence in the operator's restricted case system. Use a proportionate human check (personal link **and purchase details**, in-person check or an already known contact); a public bearer link alone never exports names/comments. Only owners with password confirmation within five minutes can verify, export, block, correct, erase or resolve requests. Workers/managers cannot use these APIs. Blocking hides optional fields/free text from operational order APIs. Erasure leaves the order and fulfilment intact. Correction requires existing recorded consent and an unexpired/un-erased optional-data purpose; erased fields cannot be restored by this workflow. Send the decision securely outside the app and resolve the record. Do not treat resolution as automatic delivery of a response.

Download the destruction-log extract from the retention section. It includes categories, internal subject references, system, method, reason/time and actor references without erased values; pagination retains all pages. Responsible people must separately complete/sign the destruction act, including operator/processor details, responsible persons' names/positions/signatures and any information required by Roskomnadzor Order №179; retain the act plus log extract for three years. The download is supporting evidence, not an automatically signed statutory act or proof that restricted backup media have already expired. Minimize copies of exports, keep them restricted and remove working copies after securely answering the request.

## Operator responsibilities before real-data launch

- Maintain a processing inventory: contract-order metadata; optional guest fields by separate consent; staff accounts/memberships/password hashes; sessions/security counters; consent/request/destruction evidence; aggregates; browsers and restricted backups. Record purposes, bases, recipients, access and retention for each. Accounting and statutory personnel records stay in existing systems.
- Verify infrastructure locations including application execution, database, support access, logs, backup/replication and subcontractors. Russian database localization is a separate launch gate ([Art. 18(5)](https://www.consultant.ru/document/Cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/)). Approve processing assignments/contracts and any legally applicable transfer arrangements; a checkbox is not a replacement.
- Appoint responsible people, approve access/termination and staff training, assess threats/harm and applicable security measures, implement device/host protection, access review, encrypted backups, monitoring and tested recovery ([Art. 19](https://www.consultant.ru/document/cons_doc_LAW_61801/ca9e5658710519f09ab2fdb8196fcb3eb024a051/)). Disable unnecessary provider access/IP/URL logs; the app redacts DB errors and uses keyed throttling identifiers, but cannot configure provider logs remotely.
- Confirm RKN notification/update duties and submit the operator-approved details separately ([Art. 22](https://www.consultant.ru/document/cons_doc_LAW_61801/d996966e22e1320c9de1ab82d9f6be12c3d9d765/)). Prepare a rights-response process with statutory deadlines and permitted exceptions.
- Maintain an incident contact/on-call process: contain, preserve necessary evidence securely, assess impacts, notify RKN within the applicable **24-hour initial / 72-hour investigation** duties, and track corrective measures ([Art. 21](https://www.consultant.ru/document/cons_doc_LAW_61801/d3fe43a7c415353b17faab255bc0de92bea127da/)). The operator makes submissions and approvals; the app does not send them.

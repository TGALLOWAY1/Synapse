#!/usr/bin/env node
/**
 * One-shot migration: backfill multi-provider fields on existing LinkedIn
 * recruiter records so they work under the new `userId`-based auth system.
 *
 * Safe to re-run — the update is a no-op for already-migrated documents
 * (records where `userId` is already set are skipped).
 *
 * Usage:
 *   MONGODB_DATA_API_URL=... MONGODB_DATA_API_KEY=... \
 *   MONGODB_DATA_SOURCE=... MONGODB_DB_NAME=synapse \
 *   node scripts/migrate-recruiters-to-users.mjs [--dry-run]
 */

const DRY_RUN = process.argv.includes('--dry-run');

const {
  MONGODB_DATA_API_URL,
  MONGODB_DATA_API_KEY,
  MONGODB_DATA_SOURCE,
  MONGODB_DB_NAME = 'synapse',
} = process.env;

if (!MONGODB_DATA_API_URL || !MONGODB_DATA_API_KEY || !MONGODB_DATA_SOURCE) {
  console.error(
    'Missing MongoDB Data API env vars. Set MONGODB_DATA_API_URL, MONGODB_DATA_API_KEY, MONGODB_DATA_SOURCE.'
  );
  process.exit(1);
}

async function runMongoAction(action, payload) {
  const response = await fetch(`${MONGODB_DATA_API_URL}/action/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/ejson',
      'api-key': MONGODB_DATA_API_KEY,
    },
    body: JSON.stringify({
      dataSource: MONGODB_DATA_SOURCE,
      database: MONGODB_DB_NAME,
      ...payload,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mongo ${action} failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function main() {
  console.log(`[migrate] Scanning recruiters collection${DRY_RUN ? ' (dry-run)' : ''}…`);

  const { documents: legacy = [] } = await runMongoAction('find', {
    collection: 'recruiters',
    filter: { userId: { $exists: false }, linkedinId: { $exists: true } },
    projection: { _id: 0, linkedinId: 1, email: 1, name: 1 },
    limit: 10000,
  });

  console.log(`[migrate] Found ${legacy.length} legacy LinkedIn records to migrate.`);
  if (legacy.length === 0) {
    console.log('[migrate] Nothing to do. Exiting.');
    return;
  }

  let migrated = 0;
  let skipped = 0;

  for (const doc of legacy) {
    if (!doc.linkedinId) {
      skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      console.log(`[migrate] would update linkedinId=${doc.linkedinId} (${doc.email || 'no email'})`);
      migrated += 1;
      continue;
    }

    await runMongoAction('updateOne', {
      collection: 'recruiters',
      filter: { linkedinId: doc.linkedinId, userId: { $exists: false } },
      update: {
        $set: {
          userId: doc.linkedinId,
          authProvider: 'linkedin',
          providerUserId: doc.linkedinId,
          emailVerified: true,
        },
      },
    });
    migrated += 1;
  }

  console.log(
    `[migrate] Done. Migrated: ${migrated}, skipped: ${skipped}${DRY_RUN ? ' (dry-run — nothing written)' : ''}.`
  );
  console.log(
    '[migrate] Next: create unique indexes (see docs/auth.md → "Recommended indexes").'
  );
}

main().catch((error) => {
  console.error('[migrate] Failed:', error);
  process.exit(1);
});

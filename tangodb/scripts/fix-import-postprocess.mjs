/**
 * Post-import fix: attach default location, link prices/subscription groups, backfill payments.
 */
import { runImportPostprocess } from './lib/import-postprocess.mjs';
import { createSupabaseClient } from './lib/import-common.mjs';

function parseFixArgs(argv) {
  const args = { orgId: null, locationId: null, locationName: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--org-id') args.orgId = argv[++i];
    else if (a === '--location-id') args.locationId = argv[++i];
    else if (a === '--location-name') args.locationName = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseFixArgs(process.argv);
  if (args.help || !args.orgId) {
    console.log(
      'Usage: node scripts/fix-import-postprocess.mjs --org-id UUID (--location-name NAME | --location-id UUID) [--dry-run]'
    );
    process.exit(args.help ? 0 : 1);
  }

  const supabase = createSupabaseClient();
  console.log(`Org: ${args.orgId}`);
  console.log(`Mode: ${args.dryRun ? 'dry-run' : 'apply'}`);

  const stats = await runImportPostprocess(supabase, args.orgId, {
    locationId: args.locationId,
    locationName: args.locationName,
    dryRun: args.dryRun,
  });

  console.log('\nDone:', JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

#!/usr/bin/env node

const { randomBytes } = require('crypto');
const process = require('process');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error('\n❌ Missing Supabase environment variables.');
    console.error('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
    process.exit(1);
  }

  console.log('🔍 Connecting to Supabase project at %s', url);
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false }
  });

  const testUsername = `healthcheck_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const payload = {
    username: testUsername,
    display_name: 'Health Check User',
    password_hash: randomBytes(32).toString('hex'),
    salt: randomBytes(16).toString('hex'),
    created_at: now,
    last_login_at: now,
    preferences_snapshot: {},
    watched_history: [],
    favorites_list: [],
    last_favorites_sync: now
  };

  console.log('🧪 Inserting test user %s into auth_users…', testUsername);
  const { error: insertError } = await supabase.from('auth_users').insert(payload);
  if (insertError) {
    console.error('\n❌ Failed to insert test user.');
    console.error(insertError);
    process.exit(1);
  }

  console.log('✅ Insert succeeded. Verifying the record exists…');
  const { data: rows, error: selectError } = await supabase
    .from('auth_users')
    .select('username, created_at')
    .eq('username', testUsername)
    .limit(1);

  if (selectError) {
    console.error('\n❌ Failed to fetch test user.');
    console.error(selectError);
    await cleanup(supabase, testUsername);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.error('\n❌ Test user was not found after insertion.');
    await cleanup(supabase, testUsername);
    process.exit(1);
  }

  console.log('✅ Read succeeded. Cleaning up test user…');
  const { error: deleteError } = await supabase.from('auth_users').delete().eq('username', testUsername);
  if (deleteError) {
    console.error('\n⚠️ Could not delete test user. You may want to remove %s manually.', testUsername);
    console.error(deleteError);
    process.exit(1);
  }

  console.log('🎉 Supabase connection looks good!');
}

async function cleanup(supabase, username) {
  try {
    await supabase.from('auth_users').delete().eq('username', username);
  } catch (err) {
    // Ignore cleanup errors.
  }
}

main().catch((err) => {
  console.error('\n❌ Unexpected error while testing Supabase connection.');
  console.error(err);
  process.exit(1);
});

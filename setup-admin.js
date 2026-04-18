require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const supabase = require('./supabase/client');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

(async () => {
  console.log('\n  Admin Credential Setup\n');

  const email = await ask('  Admin email    : ');
  const password = await ask('  Admin password : ');
  rl.close();

  if (!email || !password) {
    console.log('\n  Error: email and password are required.\n');
    process.exit(1);
  }

  if (password.length < 8) {
    console.log('\n  Error: password must be at least 8 characters.\n');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);

  await supabase.from('admin_users').delete().neq('id', 0);

  const { error } = await supabase
    .from('admin_users')
    .insert({ email, password_hash: hash });

  if (error) {
    console.error('\n  Error:', error.message, '\n');
    process.exit(1);
  }

  console.log('\n  Admin account created / updated.');
  console.log(`  Email    : ${email}`);
  console.log('  Password : (hidden)\n');
})();
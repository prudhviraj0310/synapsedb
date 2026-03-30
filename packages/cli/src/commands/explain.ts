import chalk from 'chalk';

export async function handleExplain(query?: string) {
  const target = query || 'users.get()';
  
  console.log(chalk.bold.magenta(`\n🧐 DELETE COMPLEXITY: The SynapseDB Way for '${target}'`));
  console.log(chalk.dim('Why developers are deleting 90% of their database code...\n'));

  console.log(chalk.bgRed.white.bold(' ❌ THE NORMAL WAY (Pain) '));
  console.log(chalk.red(`
async function getUser(id) {
  // 1. Check Redis Cache
  const cached = await redis.get(\`user:\${id}\`);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      console.error('Cache corruption', e);
    }
  }

  // 2. Fallback to Postgres
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new Error('Not found');

  // 3. Sync Back to Redis (Don't forget TTL!)
  await redis.set(\`user:\${id}\`, JSON.stringify(user), 'EX', 120);

  return user;
}
  `));

  console.log(chalk.bgGreen.black.bold('\n ✔ THE SYNAPSE TERMINAL OS WAY '));
  console.log(chalk.green(`
// 1. One Line. Zero Stress.
const user = await db.find('users', { id });
  `));

  console.log(chalk.bold.yellow(`\n🔥 Result: SynapseDB internally parsed your AST and did all the above logic in <1ms without you writing a single line.`));
  console.log(chalk.dim(`Try running 'npx synapsedb trace' to see it in action.\n`));
}

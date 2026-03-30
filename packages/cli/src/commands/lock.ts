import chalk from 'chalk';

// -----------------------------------------------------
// 🔐 SYNAPSE LOCK (CRYPTOGRAPHIC SWEEPER)
// -----------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function handleLock() {
  console.clear();
  console.log(chalk.red.bold('⚠ UNSECURED PII IDENTIFIED IN DATA LAYER\n'));
  await sleep(800);

  // Generate a mock Database Table
  let rows = [
    `| ID   | Name               | Email                       | SSN           | Balance  |`,
    `|------|--------------------|-----------------------------|---------------|----------|`,
    `| 1041 | Alex Mercer        | alex.mercer@gmail.com       | ***-**-4291   | $ 12,400 |`,
    `| 1042 | Sarah Jenkins      | s.jenkins99@yahoo.com       | ***-**-1104   | $ 41,200 |`,
    `| 1043 | Michael Chen       | mchen.business@corp.net     | ***-**-8842   | $ 9,150  |`,
    `| 1044 | Elena Rostova      | elena.r@secured-mail.ru     | ***-**-9011   | $ 84,000 |`,
    `| 1045 | James D. Haliday   | jhaliday@oasis.io           | ***-**-3341   | $ 1M+    |`,
    `| 1046 | Victoria Stone     | v.stone.law@legal.com       | ***-**-7552   | $ 210,00 |`,
    `| 1047 | David Washington   | dwash@tech-startup.io       | ***-**-1299   | $ 4,200  |`,
  ];

  for (let r of rows) {
    console.log(chalk.gray(r));
  }

  await sleep(1500);
  console.log(chalk.magenta.bold('\n⚡ INIT: SYNAPSE CRYPTOGRAPHIC MATRIX LOCK '));
  await sleep(600);

  const hexChars = '0123456789ABCDEF';
  const lockFrames = 25; 

  // Matrix Sweep Animation
  for (let frame = 0; frame < lockFrames; frame++) {
     console.clear();
     console.log(chalk.red.bold('⚠ UNSECURED PII IDENTIFIED IN DATA LAYER\n'));
     
     // Encrypt column by column based on frame progression
     for (let i = 0; i < rows.length; i++) {
        if (i < 2) { 
           console.log(chalk.cyan(rows[i])); 
           continue; 
        } // Header
        
        let originalLine = rows[i];
        let encryptedLine = '';

        for (let c = 0; c < originalLine.length; c++) {
           const char = originalLine[c];
           const progress = (c / originalLine.length) * lockFrames;
           
           if (char === '|' || char === ' ') {
               encryptedLine += char; // Keep structure
           } else if (frame >= progress) {
               // Scramble it to hex if the wave has passed this character
               const randomHex = chalk.green(hexChars[Math.floor(Math.random() * hexChars.length)]);
               encryptedLine += randomHex;
           } else {
               // Render plaintext but gray if not swept yet
               encryptedLine += chalk.gray(char);
           }
        }
        console.log(encryptedLine);
     }
     console.log(chalk.magenta.bold('\n⚡ INIT: SYNAPSE CRYPTOGRAPHIC MATRIX LOCK [ ENCRYPTING VIA SHA-256 ]'));
     
     await sleep(40);
  }

  // Final State
  console.clear();
  console.log(chalk.green.bold('✔ PII SECURED. VAULT LOCKED.\n'));
  for (let i = 0; i < rows.length; i++) {
     if (i < 2) { 
       console.log(chalk.cyan(rows[i])); 
       continue; 
     } 
     let finalLock = '';
     for (const char of rows[i]) {
         finalLock += (char === '|' || char === ' ') ? char : chalk.green(hexChars[Math.floor(Math.random() * hexChars.length)]);
     }
     console.log(finalLock);
  }

  console.log(chalk.green.bold('\n🔒 SYSTEM SECURED: 0x8F9B2A4C9D2E1F0A'));
  process.stdout.write('\x07');
  process.exit(0);
}

/**
 * Utilitário para Criptografar Certificado Digital A1 (.pfx)
 * Gera variáveis de ambiente seguras (AES-256-GCM) para Vercel / Render / Nuvem
 * 
 * Uso:
 *   node scripts/encrypt-cert.js <arquivo.pfx> <senha>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('================================================================');
  console.log('🔐 GERADOR DE CERTIFICADO CRIPTOGRAFADO (AES-256-GCM) PARA NUVEM');
  console.log('================================================================');
  console.log('Uso: node scripts/encrypt-cert.js <caminho_do_arquivo.pfx> [senha]');
  console.log('');
  console.log('Exemplo:');
  console.log('  node scripts/encrypt-cert.js "C:\\certificados\\meu-certificado.pfx" "123456"');
  process.exit(1);
}

const certPath = path.resolve(args[0]);
const certPassword = args[1] || '';

if (!fs.existsSync(certPath)) {
  console.error(`❌ Erro: Arquivo não encontrado em "${certPath}"`);
  process.exit(1);
}

const pfxBuffer = fs.readFileSync(certPath);
console.log(`\n📄 Arquivo lido: ${certPath} (${pfxBuffer.length} bytes)`);

// 1. Gera chave secreta forte de 32 bytes (256 bits)
const secretKey = crypto.randomBytes(32).toString('hex');
const keyBuffer = crypto.createHash('sha256').update(secretKey).digest();

// 2. Criptografa o arquivo .pfx usando AES-256-GCM
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
const encrypted = Buffer.concat([cipher.update(pfxBuffer), cipher.final()]);
const authTag = cipher.getAuthTag();

// Empacota no formato IV:AUTHTAG:CIPHERTEXT
const encryptedPayload = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;

// 3. Versão alternativa em Base64 simples
const base64Payload = pfxBuffer.toString('base64');

console.log('\n================================================================');
console.log('✅ CERTIFICADO CRIPTOGRAFADO COM SUCESSO! (AES-256-GCM)');
console.log('================================================================');
console.log('\n👉 Copie e cole estas variáveis nas configurações da VERCEL ou RENDER:\n');
console.log('----------------------------------------------------------------');
console.log(`SEFAZ_CERT_ENCRYPTED=${encryptedPayload}`);
console.log(`SEFAZ_CERT_KEY=${secretKey}`);
if (certPassword) {
  console.log(`SEFAZ_CERT_PASSWORD=${certPassword}`);
}
console.log('----------------------------------------------------------------');
console.log('\n💡 Com essas variáveis, o monitor na nuvem iniciará com o certificado');
console.log('   descriptografado apenas na memória RAM, 100% seguro e 24h ativo!');
console.log('================================================================\n');

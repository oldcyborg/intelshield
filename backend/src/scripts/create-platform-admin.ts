import 'dotenv/config';
import dataSource from '../database/data-source';
import { hashPassword } from '../auth/password';
import { normalizeEmail } from '../common/identifiers';

/** Creates the one account that can open companies. Run once per server. */
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    console.error('Cần đặt PLATFORM_ADMIN_EMAIL và PLATFORM_ADMIN_PASSWORD (ít nhất 12 ký tự) trong backend/.env');
    process.exit(1);
  }
  await dataSource.initialize();
  const existing = await dataSource.query(`SELECT 1 FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`, [
    normalizeEmail(email),
  ]);
  if (existing.length) {
    console.log(`Đã có tài khoản ${email}, không tạo lại.`);
  } else {
    await dataSource.query(
      `INSERT INTO users (user_type, full_name, email, password_hash) VALUES ('platform_admin', 'Quản trị nền tảng', $1, $2)`,
      [normalizeEmail(email), await hashPassword(password)],
    );
    console.log(`Đã tạo quản trị nền tảng ${email}`);
  }
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
